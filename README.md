# Browser CAD AI

A standalone browser-based AI CAD app focused on a clean core workflow:

- conversational design brief -> AI planning -> OpenSCAD generation
- local OpenSCAD WASM preview and STL export
- parsed parametric controls for quick iteration
- optional image references passed inline to the model

## Stack

- React + Vite + TypeScript
- OpenRouter for LLM access
- local OpenSCAD WASM worker for preview/export
- Three.js / React Three Fiber for geometry viewing

## Product direction

This refactor treats the project as a standalone browser CAD workbench rather than a trimmed copy of CADAM.
The emphasis is on:

- a clear separation between app state, AI orchestration, and CAD runtime services
- a parameter-first OpenSCAD artifact model
- browser-local preview/export with minimal server assumptions
- easy future extension for persistence, file workspaces, repair loops, or more CAD tools

## Development

```bash
npm install
npm run dev
```

## Configuration

Provide an OpenRouter API key either by:

1. copying `.env.example` to `.env.local` and setting `VITE_OPENROUTER_API_KEY`, or
2. pasting the key into the app UI.

## Notes

- The LLM API key is used directly in the browser, so this is intended for local/dev or trusted personal use.
- Conversation state is currently in-memory only.
- OpenSCAD compilation and export stay local in the browser worker.
- Visual styling is intentionally minimal; the core architecture is the focus.



# OpenSCAD Language Reference

https://en.wikibooks.org/wiki/OpenSCAD_User_Manual#The_OpenSCAD_Language_Reference