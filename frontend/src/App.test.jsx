import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App.jsx';

describe('App component', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ system: { admin_name: 'Test Admin' } }),
      }),
    );
  });

  it('renders main menu and application title', async () => {
    render(<App />);

    expect(await screen.findByText(/RentManager/i)).toBeInTheDocument();
    expect(screen.getByText(/Main Menu/i)).toBeInTheDocument();
    expect(await screen.findByText('Test Admin')).toBeInTheDocument();
  });
});
