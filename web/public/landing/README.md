# Mise landing page

A scroll-driven homepage for Mise. One HTML file, no build step, no dependencies beyond Google Fonts.

Open it at `http://localhost:5173/landing/index.html` while `bun run dev` is running.

## What moves

- Hero: six dishes orbit the headline, then fly into a menu grid as you scroll.
- Sesame, chili and scallion particles drift down, dodge the cursor, and burst on click.
- Ideate: the prompt types itself, the checklist ticks, the logo stamps in and prices count up.
- Simulate: a Friday runs from 11 AM to 2 AM on the map, day to night, with live orders and hourly bars.
- Ask why: objection bars grow and their percentages count up.
- A photo strip slides both ways and leans with scroll speed.
- Closing: a spinning bowl with rising steam and a letter-by-letter headline.

Reduced-motion users get the static layout.

## Content

All photos are Mise's own generated dishes from `data/generated/`, resized to 700 px.
All numbers come from the Crunch House fixtures and the city data.
Rebuild `data.js` with `bun scripts/build-landing-data.ts`.
