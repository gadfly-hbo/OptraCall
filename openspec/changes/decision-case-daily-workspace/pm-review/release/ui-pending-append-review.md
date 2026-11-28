# 6bc7 运行中追加片段的限定实际核对

固定候选 `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`，未改产品／测试。独立运行官方 Pi＋本地合成 Provider，真实产品浏览器先明确发送原 composer 文本，Provider 在收到请求后持住回复；从 Home 带入同已挂载事项的新片段并明确追加，再释放 Provider 成功回复。

[实际收据](pending-append/receipt.json)结果 `PASS_NO_SENT_TEXT_REINTRODUCED`；[日志](ui-pending-append.log)，仅一次用户明确 business-role messages POST。成功后 composer 为 `原输入：同已挂载事项的新输入，保留现有草稿`，`previousSentTextStillPresent:false`，`newFragmentPresent:true`。未发现本次实际正常路径把已发送旧话重新带到下一次发送的缺陷，不建议据此新增阻断。

实际运行修正了最初假设：原用户消息已有 native `requestReceipt` 时，`canSettleDiscussionMessage` 即核定已被原生历史接受并清理已发草稿；这发生在 Provider 回复仍被持住时，并不等 Provider 成功回复才清。第一份自有探针错误地等待“仍等于旧已发文本”，因此超时；该假设错误单列 `pending-append/assumption-old-text-would-remain.json`，不是产品 FAIL。

本记录只证明上述实际路径；没有制造长时间丢失原生接受回执、特定网络乱序等额外条件，不把未测情形泛化为已发现风险。首用及其他 UI 结论仍按各自报告与候选核定。
