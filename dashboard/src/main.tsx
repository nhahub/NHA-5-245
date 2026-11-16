import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import '@fontsource-variable/inter';
import './styles.css';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
});

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
  <BrowserRouter><App /></BrowserRouter>
</QueryClientProvider>);
