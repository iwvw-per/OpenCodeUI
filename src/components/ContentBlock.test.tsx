import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// CodePreview 在 ContentBlock 里是 lazy() 的（避免把 CodeMirror 打进首屏），
// lazy 组件总是异步解析，所以断言必须用 findBy* 等待它挂载。
import { ContentBlock } from './ContentBlock'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code, layoutVersion }: { code: string; layoutVersion?: number }) => (
    <pre data-testid="code-preview" data-layout-version={layoutVersion}>
      {code}
    </pre>
  ),
}))

vi.mock('../contexts', () => ({
  useFullscreenLayer: () => ({ isOpen: false, open: vi.fn() }),
}))

describe('ContentBlock', () => {
  it('remeasures expanded content after its layout transition without paint containment', async () => {
    const { container } = render(
      <ContentBlock label="Output" content="tool output" defaultCollapsed stateKey="content-block-transition-test" />,
    )

    const block = screen.getByText('Output').closest('.rounded-md')
    expect(block).not.toHaveClass('contain-content')

    fireEvent.click(screen.getByText('Output'))

    // 等 lazy 的 CodePreview 解析并挂载
    expect(await screen.findByTestId('code-preview')).toHaveAttribute('data-layout-version', '0')

    const body = container.querySelector('[data-content-block-body]')
    expect(body).not.toBeNull()
    fireEvent.transitionEnd(body!)

    expect(screen.getByTestId('code-preview')).toHaveAttribute('data-layout-version', '1')
  })
})
