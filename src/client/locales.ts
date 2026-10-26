/** Locale-owned annotation actions, cards, and recovery messages. */
export const zh = {
  add: '添加到对话', count: '{count} 条注释', comment: '添加评论', save: '保存', cancel: '取消', delete: '删除',
  quote: '所选文本', opinion: '用户评论', locate: '跳转到原文', edit: '编辑注释', sending: '发送中', sent: '已发送',
  uncertain: '上次发送结果未确认，请先检查对话记录，再决定是否重新附带', reattach: '重新附到下一条消息',
  storageError: '批注尚未保存到浏览器，请保留此页面并检查浏览器存储空间',
  attachError: '批注尚未附到输入框，请结束当前命令后重试',
  loadError: '无法读取已有批注，已保留原始数据，请检查浏览器存储后重试',
  locateError: '暂时无法定位原文，请展开相关回复后重试',
  navigation: '注释 {number}：{quote}', navigationMany: '{count} 条注释：{quote}',
} satisfies Record<string, string>
/** Keys accepted by the annotations locale namespace. */
export type AnnotationKey = keyof typeof zh
/** English copy checked against the Chinese dictionary. */
export const en = {
  add: 'Add to conversation', count: '{count} annotations', comment: 'Add a comment', save: 'Save', cancel: 'Cancel', delete: 'Delete',
  quote: 'Selected text', opinion: 'Your comment', locate: 'Go to source', edit: 'Edit annotation', sending: 'Sending', sent: 'Sent',
  uncertain: 'The last send could not be confirmed. Check the conversation before attaching again.', reattach: 'Attach to next message again',
  storageError: 'Annotations are not saved in this browser. Keep this page open and check browser storage.',
  attachError: 'Annotations could not be attached. Finish the current command and try again.',
  loadError: 'Saved annotations could not be read. Original data was preserved; check browser storage and retry.',
  locateError: 'The source could not be located. Expand the relevant reply and try again.',
  navigation: 'Annotation {number}: {quote}', navigationMany: '{count} annotations: {quote}',
} satisfies Record<AnnotationKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { annotations: AnnotationKey }
}
