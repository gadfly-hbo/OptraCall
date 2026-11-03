/** Fixed product task capabilities; each optional boolean remains its sole persisted authority. */
export const TASK_CAPABILITIES = [
  { id: 'simulationTools', label: '经营推演工具', description: '多方案推演、压力对照和证据读取；固化快照仍由你确认。' },
  { id: 'tradeAreaTools', label: '商圈数据连接器', description: '本机商圈快照：筛选、档案与自定义权重评分。连接器无网络外发。' },
  { id: 'weatherTools', label: '历史天气连接器', description: '外部网络：仅向 archive-api.open-meteo.com 发送坐标、日期与字段，无密钥；免费 API 仅限非商业用途。' },
] as const;
export type TaskCapability = typeof TASK_CAPABILITIES[number]['id'];
export type TaskCapabilities = Partial<Record<TaskCapability, boolean>>;
export const isTaskCapability = (value: unknown): value is TaskCapability => TASK_CAPABILITIES.some(item => item.id === value);
