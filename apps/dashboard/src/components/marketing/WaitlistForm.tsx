'use client'

import { useState } from 'react'

export default function WaitlistForm() {
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitted(true)
    ;(e.currentTarget as HTMLFormElement).reset()
    setTimeout(() => setSubmitted(false), 2500)
  }

  return (
    <form className="waitlist-form" onSubmit={handleSubmit}>
      <input
        type="email"
        className="waitlist-input"
        placeholder="you@email.com"
        required
        aria-label="Email address"
      />
      <button
        type="submit"
        className="btn btn-primary"
        style={submitted ? { background: '#059669' } : undefined}
      >
        {submitted ? 'Added ✓' : 'Join Waitlist'}
      </button>
    </form>
  )
}
