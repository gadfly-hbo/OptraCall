import path from 'node:path';
import { constants, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectStore, UploadedFile } from './project-store.ts';
import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { StrategyDiscussionStore, StrategyDiscussionFault, discussionHash } from './strategy-discussion-store.ts';
import { createStrategyDiscussionSource } from './strategy-discussion-sources.ts';
import { isDiscussionSourceExcluded } from './strategy-discussion-source-scope.ts';
import { parseAttachment, validateAttachmentName } from './strategy-attachment-document.ts';
import { attachmentExtensions, strategyAttachmentKind, strategyAttachmentLimit } from './strategy-attachment-types.ts';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=(code:string,status=409):never=>{throw new StrategyDiscussionFault(code,status);};
const projectEvidence=(upload:UploadedFile)=>/^(020_clean|060_reports)\//.test(upload.path)&&attachmentExtensions.some(ext=>upload.originalName.toLowerCase().endsWith(ext))&&upload.bytes<=strategyAttachmentLimit;
const projectSource=(projectId:string,upload:UploadedFile,legacy=false)=>createStrategyDiscussionSource(upload.originalName,{
  kind:strategyAttachmentKind,projectId,fileId:legacy?discussionHash([projectId,upload.originalName]):upload.id,uploadId:upload.id,path:upload.path,
},upload.sha256,upload.uploadedAt);
const standaloneSource=(discussionId:string,name:string,hash:string)=>createStrategyDiscussionSource(name,{
  kind:strategyAttachmentKind,discussionId,fileId:discussionHash([discussionId,name]),
},hash,hash);
type Projects=Pick<ProjectStore,'get'|'upload'|'captureFeedbackFile'>;

export class StrategyAttachments {
  private discussions:StrategyDiscussionStore;
  private projects:Projects;
  constructor(discussions:StrategyDiscussionStore,projects:Projects){this.discussions=discussions;this.projects=projects;}
  private current(owner:StrategyDiscussion){
    const latest=this.discussions.get(owner.id);
    if(latest.businessOwner||latest.projectId!==owner.projectId)fail('strategy_attachment_not_authorized',403);
    return latest;
  }
  private async project(owner:StrategyDiscussion){
    this.current(owner);
    if(!owner.projectId)return fail('strategy_attachment_not_authorized',403);
    const record=await this.projects.get(owner.projectId);
    if(record.archivedAt!==null)fail('strategy_attachment_not_authorized',403);
    return record;
  }
  async projectLibrary(id:string) {
    const project=await this.projects.get(id);
    if(project.archivedAt!==null)fail('strategy_attachment_not_authorized',403);
    return project.uploads.filter(projectEvidence).map(file=>projectSource(project.id,file));
  }
  async library(owner:StrategyDiscussion){
    const current=this.current(owner);
    if(!current.projectId)return current.sources.filter(s=>s.target.kind===strategyAttachmentKind&&s.target.discussionId===current.id);
    return this.projectLibrary(current.projectId);
  }
  private async folder(owner:StrategyDiscussion,create=false){
    this.current(owner);
    const dir=path.join(this.discussions.directory(owner.id),'attachments');
    if(create)await fs.mkdir(dir,{mode:0o700}).catch(err=>{if(err.code!=='EEXIST')throw err;});
    const stat=await fs.lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('strategy_attachment_unsafe_file');
    return dir;
  }
  async add(owner:StrategyDiscussion,name:string,bytes:Buffer):Promise<StrategyDiscussionSource>{
    owner=this.current(owner);validateAttachmentName(name);
    // Validate before making an original or a project file visible.
    await parseAttachment(name,bytes);
    const hash=sha(bytes);
    if(owner.projectId){
      const project=await this.project(owner);
      const candidates=project.uploads.filter(file=>file.path.startsWith('020_clean/')&&file.originalName===name&&projectEvidence(file));
      // Uploading a new revision through the composer must respect an explicit
      // exclusion on the original analysis material even when ProjectStore gives it a collision suffix.
      if(candidates.some(file=>isDiscussionSourceExcluded(owner,projectSource(project.id,file)))||
          owner.sourceScope?.excludedSources?.some(s=>s.target.projectId===project.id&&s.target.path==='020_clean/'+name.trim()))
        return fail('strategy_source_excluded',403);
      const existing=candidates.find(file=>file.sha256===hash);
      if(existing){const ref=projectSource(project.id,existing);await this.bytes(owner,ref);return ref;}
      const upload=await this.projects.upload({projectId:project.id,name,bytes,directory:'020_clean'});
      const current=this.current(owner);
      // Only a new upload made from this discussion can continue its selected original.
      // Existing project files with the same name are independent uploads.
      const selectedIds=new Set(current.sources.filter(s=>s.target.kind===strategyAttachmentKind&&s.target.projectId===project.id).map(s=>s.target.uploadId));
      const predecessorIds=candidates.filter(file=>selectedIds.has(file.id)).map(file=>current.projectAttachmentLineages?.[file.id]??file.id);
      const parents=new Set(predecessorIds);
      if(parents.size===1){
        const [original]=parents;
        this.discussions.write({...current,projectAttachmentLineages:{...current.projectAttachmentLineages,[upload.id]:original}});
      }
      return projectSource(project.id,upload);
    }
    const source=standaloneSource(owner.id,name,hash);
    if(isDiscussionSourceExcluded(owner,source))return fail('strategy_source_excluded',403);
    const dir=await this.folder(owner,true);
    const target=path.join(dir,source.id),temp=path.join(dir,'.'+randomUUID()+'.tmp');
    const handle=await fs.open(temp,'wx',0o600);
    try{
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      this.current(owner);
      // Publish only a complete immutable original; identical retries refer to the same bytes.
      await fs.link(temp,target).catch(error=>{if(error.code!=='EEXIST')throw error;});
    }finally{await fs.unlink(temp);}
    await this.bytes(owner,source);
    return source;
  }
  async bytes(owner:StrategyDiscussion,source:StrategyDiscussionSource):Promise<Buffer>{
    this.current(owner);validateAttachmentName(source.title);
    const t=source.target;
    if(t.kind!==strategyAttachmentKind||!/^[a-f0-9]{64}$/.test(source.sha256))return fail('strategy_attachment_not_authorized',403);
    let bytes:Buffer;
    if(t.projectId!==undefined){
      if(t.projectId!==owner.projectId)return fail('strategy_attachment_not_authorized',403);
      const project=await this.project(owner);
      const upload=project.uploads.find(f=>f.id===t.uploadId&&f.path===t.path&&projectEvidence(f));
      if(!upload)return fail('strategy_attachment_original_unavailable',404);
      if(discussionHash(projectSource(project.id,upload))!==discussionHash(source)&&discussionHash(projectSource(project.id,upload,true))!==discussionHash(source))return fail('strategy_attachment_original_changed');
      try{bytes=(await this.projects.captureFeedbackFile(project.id,upload.path,strategyAttachmentLimit)).bytes;}
      catch{ return fail('strategy_attachment_original_unavailable',404); }
      await this.project(owner);
    }else{
      if(owner.projectId||t.discussionId!==owner.id||discussionHash(source)!==discussionHash(standaloneSource(owner.id,source.title,source.sha256)))return fail('strategy_attachment_not_authorized',403);
      try{
        const file=path.join(await this.folder(owner),source.id);
        const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{
          const stat=await handle.stat();
          if(!stat.isFile()||stat.nlink!==1||stat.size>strategyAttachmentLimit)fail('strategy_attachment_unsafe_file');
          bytes=await handle.readFile();
        }finally{await handle.close();}
      }catch(error){if(error instanceof StrategyDiscussionFault)throw error;return fail('strategy_attachment_original_unavailable',404);}
    }
    if(sha(bytes)!==source.sha256)fail('strategy_attachment_original_changed');
    this.current(owner);
    return bytes;
  }
  async notes(owner:StrategyDiscussion,source:StrategyDiscussionSource){
    const notes=await parseAttachment(source.title,await this.bytes(owner,source));this.current(owner);return notes;
  }
}
