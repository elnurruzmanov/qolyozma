import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../../src/App'

it('renders the title and the three modes', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Qolyozma' })).toBeInTheDocument()
  const modes = within(screen.getByRole('navigation', { name: 'Rejimlar' })).getAllByRole('button')
  expect(modes.map((b) => b.textContent)).toEqual(['Daftar', 'Otkritka', 'Dizayn'])
})
