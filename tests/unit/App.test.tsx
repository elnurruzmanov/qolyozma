import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../../src/App'

it('renders the title and the three modes', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Qolyozma' })).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(3)
})
