# Enable SPA Project

This repository contains two main sub-projects:

- **enable-device**: A modern web application for device management and volunteer coordination.
- **functions/backend**: A Node.js backend with serverless functions for business logic, authentication, and integrations.

---

## Documentation

Project documentation lives in [`docs/space/`](docs/space/README.md). Start from the [Home](docs/space/0-home/home.md) or the [reading guide](docs/space/0-home/section-0.md), which suggests a path for each role.

| Section | What it covers |
| --- | --- |
| [1 · Context and objectives](docs/space/1-contesto-e-obiettivi/README.md) | Purpose, scope and glossary |
| [3 · Architecture](docs/space/3-architettura/README.md) | Architecture overview and one chapter per domain |
| [4 · Functional specifications](docs/space/4-specifiche-funzionali/README.md) | Functional flows by area |
| [5 · Interfaces](docs/space/5-interfacce/README.md) | Callable functions, Firestore data model, integrations |
| [6 · Operations](docs/space/6-esercizio/README.md) | Runbooks, configuration, monitoring |
| [7 · Quality and verification](docs/space/7-qualita-e-verifica/README.md) | Quality and traceability |
| [8 · Open points](docs/space/8-punti-aperti/README.md) | Documentation gaps and the gap register |
| [9 · References](docs/space/9-riferimenti/README.md) | One page per capability, use case and domain concept |

Note: the reference pages in section 9 (and the node titles listed in the section 4 tables) are written in Italian.

---

## 1. enable-device

A Vite + React TypeScript web application for managing device requests, volunteer activities, and administrative tasks.

### Features
- User authentication (login, registration, password management)
- Device request and tracking system
- Volunteer dashboard and profile management
- Admin dashboard with statistics, logs, and request management
- Timeline and shipment tracking
- Responsive layout and modern UI
- Integration with Firebase for authentication and data storage

### Structure
- `src/pages/` — Main pages (Home, Login, Register, Admin, Volunteer, etc.)
- `src/components/` — UI components (tables, layouts, timelines)
- `src/helpers/` — Utility functions and data (provinces, status helpers)
- `src/services/` — Security and API integrations (reCAPTCHA, secure calls)
- `src/shared/` — Shared types and utilities

### Getting Started
1. `cd enable-device`
2. `npm install`
3. `npm run dev` to start the development server

---

## 2. functions/backend

A Node.js backend (intended for serverless deployment, e.g., Firebase Functions) providing API endpoints and business logic.

### Features
- User registration and authentication logic
- Device request creation and management
- Volunteer assignment and management
- Security features (rate limiting, reCAPTCHA, security logs)
- Shipment request handling
- Utility scripts for data processing

### Structure
- `src/` — TypeScript source code (auth, device, security, shipments, volunteer)
- `lib/` — Compiled JavaScript output (mirrors `src/` structure)
- `package.json` — Backend dependencies and scripts

### Getting Started
1. `cd functions/backend`
2. `npm install`
3. Deploy or run locally as per your serverless platform (e.g., Firebase Functions)

---

## License

- **Code**: Licensed under the [MIT License](LICENSE).
- **Documentation** (including this README): Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
