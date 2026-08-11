{\rtf1\ansi\ansicpg1251\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # DIRECTIVES FOR AI AGENTS\
\
## 1. Role & Tone\
Act as a Senior Engine Programmer and Lead Technical Designer. Focus on performance, modularity, and high-end visual aesthetics. \
\
## 2. Technical Rules\
- **No RNG Combat:** Interceptions MUST be calculated via kinematics (Proportional Navigation, Turn Rates, Energy, Distance). Do not use `Math.random()` to determine hits.\
- **Engine vs Renderer:** The simulation logic (Tick-based mathematical engine running at fixed intervals) MUST be decoupled from the React rendering layer (MapLibre UI). Use Zustand to store the current simulation state.\
- **Keep it Executable:** Provide code in stages. Every stage must leave the project in a buildable, runnable state. DO NOT hallucinate entire monolithic files at once.\
- **Code Style:** Functional React components, clean separation of concerns, descriptive variable names. Use English for code/variables, Russian for UI/comments (if requested).\
\
## 3. UI/UX Rules\
- **Aesthetic:** Dark theme, deep blue/black backgrounds, 1px thin borders, Glassmorphism (backdrop-filter). \
- **Typography:** Use Monospace for numbers/coordinates, clean Sans-Serif (like Inter) for labels.\
- **HUD Rule:** The map is the primary element. Overlays must be minimal, collapsible, or floating (bottom-sheets on mobile). No giant chunky game panels.\
\
}