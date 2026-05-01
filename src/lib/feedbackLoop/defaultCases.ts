import type { FeedbackLoopCase } from './types.ts';

export const DEFAULT_FEEDBACK_LOOP_CASES: FeedbackLoopCase[] = [
  { id: 'cube', prompt: 'Create OpenSCAD for a 20mm cube centered at the origin.' },
  {
    id: 'through-hole-block',
    prompt: 'Create OpenSCAD for a 40x20x10 rectangular block with a centered through-hole of diameter 6 along the Z axis.',
  },
  {
    id: 'parametric-spacer',
    prompt: 'Create a parametric OpenSCAD module named spacer(outer_d=20, inner_d=8, h=12) and call it once.',
  },
  {
    id: 'bolt-circle-disk',
    prompt: 'Create OpenSCAD for a circular pattern of 6 holes around a disk: disk diameter 50, thickness 4, hole diameter 4, hole centers on a 36mm bolt circle.',
  },
  {
    id: 'rounded-plate',
    prompt: 'Create OpenSCAD for a rounded rectangular plate 60x40x4 with 8mm corner radius, using only built-in OpenSCAD operations.',
  },
  {
    id: 'open-box',
    prompt: 'Create OpenSCAD for a hollow electronics box: outer size 80x50x30, wall thickness 3, open at the top.',
  },
  {
    id: 'l-bracket',
    prompt: 'Create a bracket with an L shape: one leg 60x20x6, the other 40x20x6, with a 5mm hole centered in each leg. Keep everything as one solid.',
  },
  {
    id: 'flange-module',
    prompt: 'Create a parametric OpenSCAD module for a flange: outer diameter 50, thickness 6, center bore 20, and 4 bolt holes of diameter 5 on a 38mm bolt circle. Then instantiate it.',
  },
];
