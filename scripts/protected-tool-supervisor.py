"""Trusted lifecycle guardian. It never evaluates a tool or model response.

The direct child becomes the sandboxed process-group leader. Keeping that child
unreaped pins its PID/PGID even if Agent code exits it. Only after the owned
group contains no runnable member do we reap it and require group ESRCH.
"""
import ctypes
from collections import deque
import errno
import json
import os
import select
import signal
import socket
import sys
import time

MAX_LINE = 32 * 1024 * 1024
VERSION = 2
libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
libproc.proc_listpids.argtypes = [ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int]
libproc.proc_listpids.restype = ctypes.c_int
libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
libproc.proc_pidinfo.restype = ctypes.c_int


def members(group):
    # PROC_PGRP_ONLY=2: query only the already owned, pinned process group.
    count = 64
    while count <= 65536:
        values = (ctypes.c_uint32 * count)()
        ctypes.set_errno(0)
        size = libproc.proc_listpids(2, group, values, ctypes.sizeof(values))
        if size < 0 or size == 0 and ctypes.get_errno() not in (0, errno.ESRCH):
            raise RuntimeError('protected_cleanup_unknown')
        if size < ctypes.sizeof(values):
            return {int(value) for value in values[:size // 4] if value}
        count *= 2
    raise RuntimeError('protected_cleanup_unknown')


def no_longer_runnable(pid):
    # PROC_PIDTBSDINFO=3. A zombie is no longer returned by this libproc query
    # on supported macOS; an ESRCH is also an irreversible exit observation.
    value = ctypes.create_string_buffer(4096)
    ctypes.set_errno(0)
    size = libproc.proc_pidinfo(pid, 3, 0, value, len(value))
    if size == 0:
        if ctypes.get_errno() == errno.ESRCH:
            return True
        raise RuntimeError('protected_cleanup_unknown')
    if size < 16:
        raise RuntimeError('protected_cleanup_unknown')
    return (ctypes.c_uint32 * 4).from_buffer(value)[1] == 5  # SZOMB


def group_idle(group):
    # The directly owned leader remains unreaped and cannot be PID-reused.
    # Require it to be the only remaining member and already exited; do not
    # infer natural completion from a sampled list of recyclable descendant
    # PIDs. Orphan/zombie descendants must disappear from the group first.
    return members(group) == {group} and no_longer_runnable(group) and members(group) == {group}


def clear_group(group, reaped):
    if reaped:
        # A prior proof may have reached reap but not ESRCH. Never signal that
        # numeric group again: the PID could now belong to somebody else.
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            return True
        raise RuntimeError('protected_cleanup_unknown')
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            os.killpg(group, signal.SIGKILL)
        except OSError as error:
            # An all-zombie group can report EPERM. The proof below, not this
            # signal's return value, decides whether cleanup has succeeded.
            if error.errno not in (errno.ESRCH, errno.EPERM):
                raise RuntimeError('protected_cleanup_unknown') from error
        if group_idle(group):
            # Only our held, exited leader remains. It cannot create a child;
            # the final post-reap ESRCH is still mandatory before any ACK.
            try:
                os.waitpid(group, 0)
            except OSError as error:
                # ECHILD or an interrupted ownership proof cannot authorize
                # another signal to this recyclable numeric group on retry.
                raise RuntimeError('protected_cleanup_unknown_after_reap') from error
            # Orphaned zombie children can remain briefly until launchd reaps
            # them. Once our leader is reaped, only query absence; never signal
            # the numeric group again, even during this same close request.
            while time.monotonic() < deadline:
                try:
                    os.killpg(group, 0)
                except ProcessLookupError:
                    return True
                except OSError as error:
                    if error.errno != errno.EPERM:
                        raise RuntimeError('protected_cleanup_unknown_after_reap') from error
                time.sleep(.01)
            raise RuntimeError('protected_cleanup_unknown_after_reap')
        time.sleep(.01)
    raise RuntimeError('protected_cleanup_unknown')


def reap_natural_group(group):
    # Called only after EOF and group_idle while the direct child's identity
    # is still held. Unlike clear_group, this path never sends a signal.
    try:
        os.waitpid(group, 0)
    except OSError as error:
        # An unsuccessful wait cannot authorize signalling the old number on
        # a retry. In particular ECHILD means our held identity was lost.
        raise RuntimeError('protected_cleanup_unknown_after_reap') from error
    try:
        os.killpg(group, 0)
    except ProcessLookupError:
        return
    except OSError as error:
        raise RuntimeError('protected_cleanup_unknown_after_reap') from error
    raise RuntimeError('protected_cleanup_unknown_after_reap')


def main():
    node, entry, profile, cwd = sys.argv[1:5]
    control_buffer = b''
    while b'\n' not in control_buffer:
        data = os.read(sys.stdin.fileno(), 65536)
        if not data or len(control_buffer) + len(data) > MAX_LINE:
            return 1
        control_buffer += data
    first, control_buffer = control_buffer.split(b'\n', 1)
    try:
        request = json.loads(first)
    except (ValueError, TypeError):
        return 1
    if not isinstance(request, dict) or request.get('version') != VERSION or request.get('kind') not in ('protected.execute', 'protected.open'):
        return 1
    shared = request['kind'] == 'protected.open'
    if shared and request.get('cwd') != cwd:
        return 1
    identity = {key: request.get(key) for key in ('scopeId', 'nonce', 'toolCallId')}
    if not all(isinstance(value, str) and value for value in identity.values()):
        return 1

    def emit(kind, **value):
        try:
            sys.stdout.write(json.dumps(dict(identity, version=VERSION, kind=kind, **value), separators=(',', ':')) + '\n')
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            pass

    parent_socket, child_socket = socket.socketpair()
    ready_read, ready_write = os.pipe()
    group = os.fork()
    if group == 0:
        parent_socket.close()
        os.close(ready_read)
        os.setsid()
        os.write(ready_write, b'1')
        os.close(ready_write)
        channel = child_socket.fileno()
        if channel != 3:
            os.dup2(channel, 3)
        os.set_inheritable(3, True)
        null = os.open('/dev/null', os.O_RDWR)
        for target in (0, 1, 2):
            os.dup2(null, target)
        os.closerange(4, 65536)
        environment = dict(os.environ, OPTRACALL_EXECUTION_SUPERVISOR_PID=str(os.getppid()))
        os.execve('/usr/bin/sandbox-exec', ['/usr/bin/sandbox-exec', '-p', profile, node, entry, '--worker-json'], environment)
        os._exit(127)
    child_socket.close()
    os.close(ready_write)
    if not select.select([ready_read], [], [], 5)[0] or os.read(ready_read, 1) != b'1':
        # This direct child is still unreaped and cannot be a recycled PID.
        os.kill(group, signal.SIGKILL)
        os.waitpid(group, 0)
        emit('protected.cleanup-unknown')
        return 1
    os.close(ready_read)
    emit('protected.ready', processGroup=group, supervisorPid=os.getpid())
    parent_socket.setblocking(False)
    # Keep control and data full duplex even for a large file-tool argument.
    # A blocked worker must not prevent the trusted control pipe from stopping
    # the owned group. This queue contains only already accepted parent frames.
    outbound = deque([json.dumps(request, separators=(',', ':')).encode() + b'\n'])
    outbound_offset = 0
    control_fd = sys.stdin.fileno()
    os.set_blocking(control_fd, False)
    worker_buffer = b''
    worker_open = True
    control_open = True
    result_sent = False
    reaped = False
    stop_signal = False
    draining = False
    failed = False

    def requested_stop(_number, _frame):
        nonlocal stop_signal
        stop_signal = True

    signal.signal(signal.SIGTERM, requested_stop)
    signal.signal(signal.SIGHUP, requested_stop)

    def same_identity(message):
        return isinstance(message, dict) and all(message.get(key) == value for key, value in identity.items())

    def cleanup_unknown(error):
        nonlocal failed, reaped
        if str(error) == 'protected_cleanup_unknown_after_reap':
            reaped = True
        failed = True
        # Accepted work is never replayed after retirement failure. Keep only
        # the pinned resource and its failure, not unused argument buffers.
        outbound.clear()
        emit('protected.cleanup-unknown', processGroup=group, reason=str(error), reaped=reaped)

    def worker_eof():
        nonlocal worker_open, worker_buffer, result_sent
        worker_open = False
        parent_socket.close()
        outbound.clear()
        worker_buffer = b''
        if not shared and not result_sent:
            result_sent = True
            emit('protected.result', error='protected_executor_failed', executionUnknown=True)

    while True:
        # Failure is a terminal automatic retirement state. Only a matching
        # protected.close from the trusted driver can explicitly retry it.
        close_requested = stop_signal and not failed
        stop_signal = False
        explicit_close = False
        if not close_requested:
            readable, writable, _ = select.select(([control_fd] if control_open else []) + ([parent_socket] if worker_open else []),
                                                  [parent_socket] if worker_open and outbound and not failed else [], [], .1)
            if control_open and control_fd in readable:
                data = os.read(control_fd, 65536)
                if not data:
                    # EOF is one cleanup request, not an automatic retry loop.
                    control_open = False
                    close_requested = not failed
                else:
                    control_buffer += data
            while b'\n' in control_buffer:
                line, control_buffer = control_buffer.split(b'\n', 1)
                if len(line) > MAX_LINE:
                    control_open = False
                    close_requested = not failed
                    control_buffer = b''
                    break
                try:
                    message = json.loads(line)
                    if not same_identity(message) or message.get('version') != VERSION:
                        continue
                    kind = message.get('kind')
                    if kind == 'protected.close':
                        close_requested = True
                        explicit_close = True
                    elif kind == 'protected.drain' and not draining and not failed:
                        draining = True
                        if shared and worker_open:
                            outbound.append(json.dumps(dict(identity, version=VERSION, kind='protected.release'), separators=(',', ':')).encode() + b'\n')
                    elif shared and worker_open and not failed and not close_requested and kind in ('protected.execute', 'protected.cancel'):
                        if isinstance(message.get('callId'), str) and message['callId'] and (kind == 'protected.cancel' or not draining):
                            outbound.append(line + b'\n')
                except (ValueError, TypeError):
                    pass
            if len(control_buffer) > MAX_LINE:
                control_open = False
                close_requested = not failed
                control_buffer = b''
            if worker_open and parent_socket in writable and not close_requested and outbound:
                try:
                    outbound_offset += parent_socket.send(memoryview(outbound[0])[outbound_offset:])
                    if outbound_offset == len(outbound[0]):
                        outbound.popleft()
                        outbound_offset = 0
                except BlockingIOError:
                    pass
                except OSError:
                    worker_eof()
            if worker_open and parent_socket in readable:
                try:
                    data = parent_socket.recv(65536)
                except OSError:
                    data = b''
                if not data:
                    worker_eof()
                else:
                    worker_buffer += data
                    while b'\n' in worker_buffer:
                        line, worker_buffer = worker_buffer.split(b'\n', 1)
                        if len(line) > MAX_LINE:
                            emit('protected.result', error='protected_invalid_tool_result', executionUnknown=True)
                            close_requested = not failed
                            worker_eof()
                            break
                        try:
                            message = json.loads(line)
                            # Tool channel can report data only. Even a forged
                            # valid-nonce close/event/config is never control.
                            if not same_identity(message) or message.get('version', VERSION) != VERSION:
                                continue
                            kind = message.get('kind')
                            if shared and kind == 'protected.worker-ready' and message.get('version') == VERSION:
                                emit(kind)
                            elif kind in ('protected.progress', 'protected.result'):
                                if shared and (message.get('version') != VERSION or not isinstance(message.get('callId'), str) or not message['callId']):
                                    continue
                                if kind == 'protected.result':
                                    result_sent = True
                                emit(kind, **{key: message[key] for key in ('callId', 'result', 'error') if key in message and (shared or key != 'callId')})
                        except (ValueError, TypeError):
                            pass
                    if len(worker_buffer) > MAX_LINE:
                        emit('protected.result', error='protected_invalid_tool_result', executionUnknown=True)
                        close_requested = not failed
                        worker_eof()
        if close_requested:
            try:
                # This synchronous, pinned-identity retirement is the same
                # authority used by natural collection. No other callback can
                # race a second reap or signal after that identity is gone.
                if failed and not explicit_close:
                    continue
                clear_group(group, reaped)
                reaped = True
                emit('protected.closed', processGroup=group, proof='group-esrch', mode='forced')
                return 0
            except Exception as error:
                cleanup_unknown(error)
        elif not worker_open and not worker_buffer and not failed:
            try:
                if group_idle(group):
                    reap_natural_group(group)
                    reaped = True
                    emit('protected.closed', processGroup=group, proof='group-esrch', mode='natural')
                    return 0
                # Runnable background work is normal observation, not failure.
            except Exception as error:
                cleanup_unknown(error)


def probe():
    ready_read, ready_write = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(ready_read)
        os.setsid()
        os.write(ready_write, b'1')
        os._exit(0)
    os.close(ready_write)
    if os.read(ready_read, 1) != b'1':
        os.waitpid(child, 0)
        raise RuntimeError('protected_guardian_unavailable')
    os.close(ready_read)
    clear_group(child, False)
    print('protected-guardian-ready', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(probe() if sys.argv[1:] == ['--probe'] else main())
