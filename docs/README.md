# Sibimate project documents

Copied from the Claude session on 20 November 2026. The live versions stay online; these files are a snapshot to code from.

## Decisions

- `decisions.md` holds every decision on the open questions, with what each still needs before launch.

## Architecture

- `architecture/sibimate-architecture.md` is the system design and application architecture, with both diagrams in `architecture/media/`.
- `architecture/sibimate-architecture.pdf` is the same document as a PDF.
- Live document: https://claude.ai/artifact/NEwnnaBHqoTqU7E2xZoTbc

The architecture reflects the product decisions made after planning: no service-area limit, voice-first posting with AI-written task details, no excluded work, a skilled or unskilled tag on helpers, no fixed prices, an editable commission, and payment released on the customer's completion code. [decisions.md](decisions.md) records the answers to the architecture's open questions.

## Design

`../design/canvas/` holds the source of the design canvas: one `.dc.html` file per screen and `canvas.json` for the layout.

| File | Screen |
| --- | --- |
| `Welcome.dc.html` | Welcome and sign in |
| `Main.dc.html` | Customer home |
| `CreateTask.dc.html` | Confirm task |
| `Offers.dc.html` | Helper offers |
| `Tracking.dc.html` | Task tracking |
| `WorkerHome.dc.html` | Helper: nearby tasks |
| `WorkerTask.dc.html` | Helper: task detail and quote |
| `WorkerEarnings.dc.html` | Helper: earnings |
| `AdminOverview.dc.html` | Admin overview |
| `AdminBookings.dc.html` | Admin bookings |
| `AdminWorkers.dc.html` | Admin helper verification |

These files are written for the canvas editor and do not render when opened directly in a browser. Read them for layout, copy, colours and spacing, and view the rendered screens on the live canvas: https://claude.ai/artifact/GbhkFnT6h7cscU5MRK9Qij

Design tokens used across the screens:

- Deep green `#0E5A47`, marigold `#F4B321`, ink `#13211C`, ground `#F4F6F2`
- Inter for text, Space Grotesk for headings

The screens predate the later product decisions. The home, confirm and tracking screens still need a revision for the voice-first flow, the accept or reject step, the pay-now choice and the completion code.
