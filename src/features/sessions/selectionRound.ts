/**
 * 多选行的圆角。
 *
 * 历史实现会在连续选中时让中间项变直角、首尾只圆外侧，用于把相邻选中行
 * 「拼成一条」。但列表行之间始终存在间距（space-y-0.5 / space-y-1），
 * 拼接效果并不成立，反而让选中块缺角。
 *
 * 因此现在一律返回完整圆角；参数保留是为兼容调用点。
 */
export function getSelectionRoundClass(
  _isChecked: boolean,
  _checkedPrev: boolean,
  _checkedNext: boolean,
  radius: 'md' | 'lg' = 'md',
): string {
  return radius === 'lg' ? 'rounded-lg' : 'rounded-md'
}
