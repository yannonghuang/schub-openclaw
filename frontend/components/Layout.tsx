// frontend/components/Layout.tsx
import React from 'react';
import Link from 'next/link';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="bg-gray-100 border-b p-4 mb-4">
        <nav className="flex space-x-4">
          <Link href="/dashboard" className="text-blue-600 hover:underline">Dashboard</Link>
          <Link href="/call" className="text-blue-600 hover:underline">Join Call</Link>
          <Link href="/session" className="text-blue-600 hover:underline">Sessions</Link>
          <Link href="/advice" className="text-blue-600 hover:underline">Advice</Link>
        </nav>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
