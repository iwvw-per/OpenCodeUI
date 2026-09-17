import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl, SettingRow, Toggle } from './SettingsUI'

describe('Settings UI primitives', () => {
  it('uses the row label for its single switch focus target', () => {
    const onRowClick = vi.fn()
    const onToggle = vi.fn()
    render(
      <SettingRow label="Notifications" onClick={onRowClick}>
        <Toggle enabled={true} onChange={onToggle} />
      </SettingRow>,
    )

    const toggle = screen.getByRole('switch', { name: 'Notifications' })
    expect(toggle.closest('[data-setting-label]')).toHaveAttribute('data-setting-label', 'Notifications')
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Notifications'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('switches the selected segmented option and reports the change', () => {
    function Harness() {
      const [value, setValue] = useState<'one' | 'two'>('one')
      return <SegmentedControl value={value} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} onChange={setValue} />
    }

    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('data-state', 'active')

    // Radix Tabs 在 mouseDown 上激活（见 ui/Tabs.tsx）。
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('data-state', 'inactive')
  })

  it('keeps the active option when the change is rejected by the caller', () => {
    const onChange = vi.fn(() => false)
    function Harness() {
      const [value] = useState<'one' | 'two'>('one')
      return (
        <SegmentedControl
          value={value}
          options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]}
          onChange={onChange}
        />
      )
    }

    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Two' }))

    // 受控组件：外部未更新 value 时，激活项必须保持不变。
    expect(onChange).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('data-state', 'inactive')
  })
})
