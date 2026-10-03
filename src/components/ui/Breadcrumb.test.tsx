import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './Breadcrumb'

function buildItems(count: number) {
  return Array.from({ length: count }, (_, index) => (
    <BreadcrumbItem key={index}>
      {index > 0 && <BreadcrumbSeparator />}
      {index === count - 1 ? (
        <BreadcrumbPage>item-{index}</BreadcrumbPage>
      ) : (
        <BreadcrumbLink href={`#${index}`}>item-{index}</BreadcrumbLink>
      )}
    </BreadcrumbItem>
  ))
}

describe('Breadcrumb', () => {
  it('renders all items when under the max', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList maxItems={5}>{buildItems(3)}</BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('item-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hidden paths/i })).not.toBeInTheDocument()
  })

  it('collapses the middle into an ellipsis when over the max', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList maxItems={3}>{buildItems(6)}</BreadcrumbList>
      </Breadcrumb>,
    )
    // 首个与末尾保留
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('item-5')).toBeInTheDocument()
    // 中间折叠进省略号按钮
    expect(screen.getByRole('button', { name: /hidden paths/i })).toBeInTheDocument()
    expect(screen.queryByText('item-2')).not.toBeInTheDocument()
  })

  it('does not collapse when maxItems is Infinity', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList maxItems={Infinity}>{buildItems(6)}</BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByText('item-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hidden paths/i })).not.toBeInTheDocument()
  })

  it('marks the current page with aria-current', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>{buildItems(2)}</BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByText('item-1')).toHaveAttribute('aria-current', 'page')
  })
})
