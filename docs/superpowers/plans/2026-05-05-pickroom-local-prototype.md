# PickRoom Local Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost prototype of the SerginhoEsteves PickRoom MVP that can be clicked and tested locally.

**Architecture:** Use a Vite React app with local seeded data and browser state. Keep the prototype frontend-only while modelling the future backend entities from the PRD: matches, picks, votes, daily slip, user stats, and admin settlement.

**Tech Stack:** React, Vite, TypeScript, CSS modules/global CSS, lucide-react.

---

### Task 1: Scaffold App

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/data.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Create the Vite React project files**

Create a minimal Vite app with React and TypeScript. Add scripts for `dev`, `build`, and `preview`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: dependencies install without errors.

- [ ] **Step 3: Start with a placeholder render**

Render the app shell title `PickRoom SerginhoEsteves`.

- [ ] **Step 4: Verify dev server**

Run: `npm run dev -- --host 127.0.0.1`
Expected: Vite serves the app on localhost.

### Task 2: Build Interactive MVP Surface

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/data.ts`
- Modify: `src/types.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add seed matches and users**

Add upcoming Primeira Liga-like matches and community users.

- [ ] **Step 2: Add pick state and voting**

Users can select a match, submit a pick with manual odds, and vote Trust/Doubt/Strong on picks.

- [ ] **Step 3: Add daily slip**

Generate the daily slip from top-scored picks and publish it in local UI state.

- [ ] **Step 4: Add admin settlement**

Allow settling picks as won/lost/void/half won/half lost and recalculate leaderboard.

- [ ] **Step 5: Add responsive app styling**

Use a restrained product dashboard style that looks like a community tool, not a sportsbook checkout.

### Task 3: Verify and Run

**Files:**
- No file changes expected.

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: TypeScript and Vite build succeeds.

- [ ] **Step 2: Start localhost**

Run the dev server in the background on `http://127.0.0.1:5173/`.

- [ ] **Step 3: Smoke test interactions**

Open the app and verify a user can submit a pick, vote, generate a slip, settle a pick, and see leaderboard changes.
