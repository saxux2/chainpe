'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  const toggleTheme = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    if (isDark) {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('chainpe-theme', 'light')
    } else {
      document.documentElement.setAttribute('data-theme', 'dark')
      localStorage.setItem('chainpe-theme', 'dark')
    }
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="logo">
          <img src="/logo-light.png" alt="ChainPe" className="logo-img logo-img-light" />
          <img src="/logo-dark.png" alt="ChainPe" className="logo-img logo-img-dark" />
          <span>chain<span className="logo-accent">pe</span></span>
        </Link>

        <nav className={`nav${menuOpen ? ' open' : ''}`}>
          <a href="/#problem" className="nav-link" onClick={closeMenu}>Problem</a>
          <a href="/#solution" className="nav-link" onClick={closeMenu}>Solution</a>
          <Link href="/docs" className="nav-link" onClick={closeMenu}>Docs</Link>
          <a href="/#use-cases" className="nav-link" onClick={closeMenu}>Use Cases</a>
          <a href="/#faq" className="nav-link" onClick={closeMenu}>FAQ</a>
          <Link href="/marketplace" className="nav-link" onClick={closeMenu}>Marketplace</Link>
        </nav>

        <div className="header-actions">
          <a
            href="/docs"
            className="nav-link github-link"
          >
            Docs
          </a>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">
            <svg className="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg className="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </button>
          <a href="/#get-started" className="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/>
              <path d="m12 5 7 7-7 7"/>
            </svg>
            Get Started
          </a>
        </div>

        <button
          className="mobile-menu-toggle"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  )
}
