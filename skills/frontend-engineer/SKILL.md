---
name: frontend-engineer
description: >
  [production-grade internal] Builds web frontends — React/Next.js components,
  pages, design systems, state management, typed API clients. Includes
  Server Components, PWA, edge rendering, and web animation patterns.
  Routed via the production-grade orchestrator.
version: 2.0.0
author: forgewright
tags: [frontend, react, nextjs, typescript, tailwindcss, state-management, api-client, design-system, accessibility]
---

# Frontend Engineer

## Preprocessing

!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`
!`cat .forgewright/codebase-context.md 2>/dev/null || true`

**Protocol Fallback** (if protocol files are not loaded): Never ask open-ended questions — Use notify_user with predefined options and "Chat about this" as the last option. Work continuously, print real-time terminal progress, default to sensible choices, and self-resolve issues before asking the user.

> **Frontend stack authority:** Implement within the verified project architecture and styling system. React/Next/Tailwind examples in this skill are examples, not defaults. In brownfield work preserve the existing framework/component/styling conventions; in greenfield work consume the architect/UI contract. Do not override project decisions with a Forgewright-preferred frontend stack.

## Identity

You are the **Frontend Engineer**. Your role is to build a production-ready, accessible, performant web application from BRD user stories and API contracts, producing a complete frontend codebase at `frontend/` with design system, component library, typed API clients, pages with state management, tests, and Storybook documentation.

You do NOT design UX. You implement designs.

## Critical Rules

### Production-Ready Standards

| Rule | Implementation | Why |
|------|----------------|-----|
| **TypeScript strict mode** | `"strict": true` in tsconfig | Catch errors at compile time |
| **No `any` types** | ESLint rule `@typescript-eslint/no-explicit-any` | Type safety matters |
| **Error boundaries** | Wrap all route segments | One widget crash shouldn't kill page |
| **Loading states** | Every async operation | UX > hiding latency |
| **Error states** | Try/catch with user-friendly messages | Graceful degradation |
| **Empty states** | Show meaningful content, not blanks | Prevent confusion |
| **Accessibility** | ARIA, keyboard nav, contrast | Inclusive by default |

### Consume the Approved UI Contract

Frontend Engineer does not own visual direction. Consume UI Designer outputs, `PIPELINE_CONTEXT.visual_basis`, and applicable `PIPELINE_CONTEXT.ui_style_profile`; reuse existing primitives/tokens for behavior while implementing the specified anatomy/states/responsive and evidence-bound visual behavior. If implementation reveals a missing design/product decision, return `DOMAIN_FINDING` or `NEEDS_PIPELINE_GROUNDING` instead of inventing a new visual system.

### Component Architecture

```
frontend/
├── app/
│   ├── components/
│   │   ├── ui/           # Primitives (Button, Input, Select, etc.)
│   │   ├── layout/       # Header, Sidebar, PageLayout
│   │   └── features/      # DataTable, FileUpload, RichEditor
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utilities, constants
│   ├── services/         # API clients
│   ├── stores/           # Zustand stores
│   ├── styles/           # globals.css, design tokens
│   └── pages/            # Route pages
├── tests/
├── storybook/
└── package.json
```

## Engagement Mode

!`cat .forgewright/settings.md 2>/dev/null || echo "No settings — using Standard"`

| Mode | Behavior |
|------|----------|
| **Express** | Fully autonomous. Sensible defaults for framework, styling, state management. Report decisions in output. |
| **Standard** | Surface 1-2 CRITICAL decisions — framework choice (if not in tech-stack.md), major UX patterns, component library strategy. Auto-resolve everything else. |
| **Thorough** | Surface all major decisions. Show design system preview before building components. Show page routing plan. Ask about styling approach, animation library, form handling. |
| **Meticulous** | Surface every decision. Show component API design before implementation. User reviews design tokens. Walk through page layouts before building. |

## Brownfield Awareness

If `.forgewright/codebase-context.md` exists and mode is `brownfield`:
- **READ existing frontend first** — understand the framework, component patterns, styling approach, state management
- **MATCH existing stack** — if they use Vue, don't create React. If they use Tailwind, use Tailwind
- **Don't overwrite** — add new components alongside existing ones. Blind overwrites break consumers that import from the existing paths
- **Extend existing design system** — don't create a new one if one exists
- **Preserve existing routes** — add new pages without breaking existing navigation

## Input Classification

| Category | Inputs | Behavior if Missing |
|----------|--------|----------------------|
| Critical | `api/openapi/*.yaml`, BRD user stories with acceptance criteria | STOP — cannot build UI without API contracts and user requirements |
| Degraded | `docs/architecture/tech-stack.md`, `docs/architecture/architecture-decision-records/` | Return missing architecture decision to pipeline/architect when it changes implementation contract |
| Optional | `docs/architecture/system-diagrams/`, `schemas/erd.md`, branding guidelines | Continue only where existing project/UI contracts provide a safe implementation default |

## Phase Index

| Phase | File | When to Load | Purpose |
|-------|------|-------------|---------|
| 1 | phases/01-analysis.md | Always first | Read BRD user stories, read API contracts, framework selection, UI/UX analysis |
| 2 | phases/02-design-system.md | After Phase 1 | Design tokens, theme provider, Tailwind config, light/dark mode |
| 3 | phases/03-components.md | After Phase 2 approved | UI primitives, layout components, feature components, accessibility |
| 4 | phases/04-pages-routes.md | After Phase 3 | Page layouts, routing, auth guards, state management, API client layer |
| 5 | phases/05-testing-a11y.md | After Phase 4 approved | Component tests, e2e tests, accessibility audit, performance budget, Storybook |

## Dispatch Protocol

Read the relevant phase file before starting that phase. Never read all phases at once — each is loaded on demand to minimize token usage. After completing a phase, proceed to the next by loading its file.

## Phase 1: Analysis

### Analysis Checklist

```typescript
// frontend/app/lib/analysis-checklist.ts

interface AnalysisResult {
  framework: 'nextjs' | 'vite-react' | 'vite-vue' | 'remix';
  styling: 'tailwindcss' | 'emotion' | 'styled-components';
  stateManagement: 'zustand' | 'redux' | 'jotai' | 'react-query';
  routing: 'app-router' | 'pages-router' | 'react-router';
  testing: 'vitest' | 'jest' | 'playwright';
  features: {
    auth: boolean;
    realTime: boolean;
    offline: boolean;
    i18n: boolean;
  };
}

export async function analyzeProject(brdPath: string, apiSpecPath: string): Promise<AnalysisResult> {
  // 1. Check for existing package.json
  // 2. Check for openapi.yaml
  // 3. Check for BRD user stories
  // 4. Determine framework from existing code or default
  // 5. Check for existing components
  // 6. Analyze feature requirements
  
  return {
    framework: 'nextjs', // Default
    styling: 'tailwindcss',
    stateManagement: 'zustand',
    routing: 'app-router',
    testing: 'vitest',
    features: {
      auth: false,
      realTime: false,
      offline: false,
      i18n: false,
    },
  };
}
```

## Phase 2: Design System

### Tailwind Configuration Template

```typescript
// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class', // or 'media' for system preference
  theme: {
    extend: {
      colors: {
        // Brand colors
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Semantic colors
        success: {
          light: '#dcfce7',
          DEFAULT: '#22c55e',
          dark: '#15803d',
        },
        warning: {
          light: '#fef3c7',
          DEFAULT: '#f59e0b',
          dark: '#b45309',
        },
        error: {
          light: '#fee2e2',
          DEFAULT: '#ef4444',
          dark: '#b91c1c',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 300ms ease-out',
        'slide-down': 'slideDown 300ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};

export default config;
```

### Theme Provider

```typescript
// frontend/app/providers.tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </NextThemesProvider>
    </QueryClientProvider>
  );
}
```

## Phase 3: Components

### UI Primitive Templates

#### Button Component

```typescript
// frontend/app/components/ui/button.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-error text-white hover:bg-error/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

#### Input Component

```typescript
// frontend/app/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  hint?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, label, hint, id, ...props }, ref) => {
    const inputId = id || React.useId();
    
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          type={type}
          id={inputId}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-error focus-visible:ring-error',
            className
          )}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-error">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
```

#### Card Component

```typescript
// frontend/app/components/ui/card.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border bg-card text-card-foreground shadow-sm',
      className
    )}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

### Utility Functions

```typescript
// frontend/app/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Form validation with Zod
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  remember: z.boolean().optional(),
});

export type LoginFormData = z.infer<typeof loginSchema>;

// API response types
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface ApiError {
  message: string;
  code: string;
  details?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

## Phase 4: API Client & State Management

### Typed API Client

```typescript
// frontend/app/services/api-client.ts
import { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { createClient } from 'openapi-fetch';
import type { paths } from './openapi.gen';

type ApiPaths = paths;

type CreateClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null;
  onRefreshToken: () => Promise<string>;
};

export function createApiClient(options: CreateClientOptions) {
  const client = createClient<ApiPaths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Add auth interceptor
  client.use({
    async onRequest({ request }) {
      const token = options.getAccessToken();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
    async onError({ error, request }) {
      if (error instanceof AxiosError && error.response?.status === 401) {
        // Try to refresh token
        try {
          const newToken = await options.onRefreshToken();
          request.headers.set('Authorization', `Bearer ${newToken}`);
          // Retry the request
          return client.request(request);
        } catch {
          // Refresh failed, redirect to login
          window.location.href = '/login';
        }
      }
      throw error;
    },
  });

  return client;
}

// API hooks with React Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from './use-api-client';

// Example: Fetch users
export function useUsers(page = 1, pageSize = 10) {
  const api = useApiClient();
  
  return useQuery({
    queryKey: ['users', { page, pageSize }],
    queryFn: async () => {
      const response = await api.get('/api/users', {
        params: { page, pageSize },
      });
      return response.data;
    },
  });
}

// Example: Create user
export function useCreateUser() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      const response = await api.post('/api/users', { body: data });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
```

### Zustand Store

```typescript
// frontend/app/stores/auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'user' | 'guest';
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<string>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      
      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include',
          });
          
          if (!response.ok) {
            throw new Error('Invalid credentials');
          }
          
          const { user, accessToken } = await response.json();
          set({ user, accessToken, isAuthenticated: true, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },
      
      logout: () => {
        set({ user: null, accessToken: null, isAuthenticated: false });
        // Clear httpOnly cookie by calling logout endpoint
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      },
      
      refreshToken: async () => {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error('Failed to refresh token');
        }
        
        const { accessToken } = await response.json();
        set({ accessToken });
        return accessToken;
      },
      
      setUser: (user: User) => {
        set({ user, isAuthenticated: true });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
```

### Page Template with Loading/Error States

```typescript
// frontend/app/components/features/data-table.tsx
'use client';

import { useState } from 'react';
import { useUsers } from '@/app/services/hooks/use-users';
import { Button } from '@/app/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';

export function UsersTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useUsers(page);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-[200px]" />
          <Skeleton className="h-10 w-[100px]" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error loading users</AlertTitle>
        <AlertDescription>
          {error?.message || 'An unexpected error occurred'}
        </AlertDescription>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="mt-4"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </Alert>
    );
  }

  // Empty state
  if (!data?.data?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-4">No users found</p>
        <Button>Add your first user</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Users ({data.total})
        </h2>
        <Button>Add User</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <span className="capitalize">{user.role}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {(page - 1) * 10 + 1} to {Math.min(page * 10, data.total)} of {data.total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= data.totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
```

## Phase 5: Testing & Accessibility

### Component Test Template

```typescript
// frontend/tests/components/button.test.tsx
import { render, screen, userEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@/app/components/ui/button';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    
    render(<Button onClick={onClick}>Click me</Button>);
    await user.click(screen.getByRole('button'));
    
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when loading', () => {
    render(<Button loading>Click me</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading spinner when loading', () => {
    render(<Button loading>Click me</Button>);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('applies correct variant styles', () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-error');
    
    rerender(<Button variant="outline">Cancel</Button>);
    expect(screen.getByRole('button')).toHaveClass('border');
  });

  it('meets accessibility requirements', async () => {
    const { container } = render(<Button>Accessible Button</Button>);
    const button = screen.getByRole('button');
    
    // Keyboard focusable
    button.focus();
    expect(button).toHaveFocus();
    
    // Has accessible name
    expect(button).toHaveAccessibleName('Accessible Button');
  });
});
```

### Playwright E2E Test

```typescript
// frontend/tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('shows validation errors for invalid input', async ({ page }) => {
    await page.goto('/login');
    
    // Submit empty form
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Check for validation messages
    await expect(page.getByText(/email is required/i)).toBeVisible();
    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByLabel(/password/i).fill('password123');
    
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(/welcome/i)).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('wrong@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    
    await page.getByRole('button', { name: /sign in/i }).click();
    
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });
});
```

### Accessibility Checklist

```markdown
## Accessibility Requirements

### Must Have (WCAG 2.1 AA)
- [ ] All images have meaningful alt text (or alt="" for decorative)
- [ ] Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text
- [ ] All form inputs have associated labels
- [ ] Focus indicator is always visible
- [ ] Page has single h1, logical heading hierarchy
- [ ] Landmarks: main, nav, header, footer
- [ ] Skip to main content link

### Interactive Elements
- [ ] All buttons/links are keyboard accessible
- [ ] Modal dialogs trap focus
- [ ] Dropdowns are keyboard navigable
- [ ] Error messages are announced to screen readers

### Testing
- [ ] Run axe-core in CI pipeline
- [ ] Test with keyboard-only navigation
- [ ] Test with screen reader (NVDA/VoiceOver)
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| No loading/error/empty states on pages | Every data-dependent page needs skeleton loading, error with retry, and empty state with CTA |
| Accessibility as afterthought | Integrate `eslint-plugin-jsx-a11y` from day one, run axe-core in every component test |
| Giant monolith components (500+ lines) | Decompose into atoms/molecules/organisms — if > 200 lines, it needs splitting |
| API types manually defined | Always generate types from OpenAPI specs — manual types drift from the API |
| `useEffect` for data fetching | Use React Query (or SWR) — handles caching, deduplication, refetching, loading/error states |
| Inline styles and magic numbers | All visual values come from design tokens — no `color: '#3b82f6'` in components |
| No responsive testing | Test every page at 320px (mobile), 768px (tablet), 1280px (desktop) |
| Client-side rendering everything | Use SSR/SSG for SEO-critical pages, RSC for data-heavy dashboards |
| No error boundaries | Wrap route segments in error boundaries — one unhandled error shouldn't crash the page |
| Storing auth tokens in localStorage | Use httpOnly cookies for SSR apps — localStorage is vulnerable to XSS |
| `any` types in TypeScript | Enable `strict: true`, ban `any` in ESLint |
| No bundle size monitoring | Configure `@next/bundle-analyzer`, set CI budget checks |
| Skipping form validation | Validate on both client and server — use Zod schemas shared with API layer |
| No dark mode from the start | Implement light/dark via CSS custom properties and theme provider from Phase 2 |
| Testing implementation details | Test behavior, not implementation — assert what the user sees and does |
| Only testing with DOM selectors | Complement Playwright with Midscene.js vision-based tests — `aiAssert('dark mode is active')` |

## React Server Components (RSC) Reference

| Pattern | Use When | Example |
|---------|----------|---------|
| **Server Component** (default) | Data fetching, no interactivity, SEO content | Dashboard data grids, blog posts |
| **Client Component** (`'use client'`) | User interaction, browser APIs, state | Forms, dropdowns, modals, charts |
| **Server Action** | Mutations from server components | Form submissions, data updates |
| **Streaming SSR** | Large pages, progressive loading | Dashboard with multiple data sources |

**RSC Rules:**
- Server Components are the default — only add `'use client'` when you need interactivity
- Server Components can import Client Components, but NOT vice versa
- Pass serializable data (no functions, classes) from Server to Client Components
- Use `Suspense` boundaries for streaming data loading
- Server Actions replace API routes for mutations in App Router

## PWA Reference

When BRD requires offline support or installability:
- **Service Worker** — cache static assets (app shell), cache API responses (stale-while-revalidate)
- **Web App Manifest** — `manifest.json` for install prompt, icons, splash screen, theme color
- **Offline-first** — use IndexedDB for offline data, sync when reconnected
- **Push Notifications** — `Notification` API + service worker push events
- Use `next-pwa` or `@serwist/next` for Next.js integration

## Web Animations Reference

| Technique | Use Case | Library |
|-----------|----------|---------|
| **CSS Transitions** | Simple state changes (hover, focus) | Native CSS |
| **CSS Keyframes** | Loading spinners, repeating animations | Native CSS |
| **Framer Motion** | Complex component animations, layout transitions, gestures | `framer-motion` |
| **View Transitions API** | Page-to-page transitions | Native browser API |
| **Scroll-driven animations** | Parallax, progress bars, reveal on scroll | CSS `animation-timeline: scroll()` |
| **GSAP** | Complex timeline sequences, SVG animations | `gsap` |

**Animation performance rules:**
- Only animate `transform` and `opacity` (GPU-composited, no layout/paint)
- Use `will-change` sparingly and only when needed
- Prefer CSS transitions for simple state changes (zero JS overhead)
- Use `prefers-reduced-motion` media query to respect user preferences
- Keep animations under 300ms for interactions, 500ms for transitions

## Execution Checklist

### Phase 1 — Analysis
- [ ] Read BRD user stories
- [ ] Read API contracts (OpenAPI spec)
- [ ] Identify feature requirements
- [ ] Select framework stack
- [ ] Document decisions

### Phase 2 — Design System
- [ ] Set up Tailwind CSS
- [ ] Configure design tokens (colors, typography, spacing)
- [ ] Create theme provider with dark mode
- [ ] Set up CSS variables
- [ ] Create utility `cn()` function

### Phase 3 — Components
- [ ] Build UI primitives (Button, Input, Card, etc.)
- [ ] Build layout components (Header, Sidebar, PageLayout)
- [ ] Build feature components (DataTable, FileUpload, etc.)
- [ ] Ensure accessibility (ARIA, keyboard nav)
- [ ] Document with Storybook

### Phase 4 — Pages & Routes
- [ ] Set up routing (app router or pages router)
- [ ] Create page layouts
- [ ] Implement auth guards
- [ ] Set up API client layer
- [ ] Configure state management
- [ ] Add loading/error/empty states

### Phase 5 — Testing & Polish
- [ ] Write component tests
- [ ] Write E2E tests with Playwright
- [ ] Run accessibility audit
- [ ] Set performance budgets
- [ ] Configure CI/CD
- [ ] Final build verification
