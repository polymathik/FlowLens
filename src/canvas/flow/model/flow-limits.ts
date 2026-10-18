/**
 * What a static trace cannot see, in plain words (the "this trace cannot see…" disclosure). The first
 * entries are always true of the indexer (see the Flow backend spec, "What the extractors cannot see");
 * the trace's own `notes` come first when it has any, because they describe this very trace.
 */
export const FLOW_BLIND_SPOTS: readonly string[] = [
  'Calls on an object whose type the index cannot determine (untyped values, `any`, function-typed properties) are missing.',
  'Handlers and components are followed when they are passed by name (arguments, JSX, template bindings); names defined inside a template are skipped rather than guessed.',
  'Imports through package.json "#alias" paths are followed; one that matches no file shows as unresolved.',
  'Which implementation of an interface or override runs depends on the object at runtime: such hops are drawn amber with their candidates.',
  'Anonymous callbacks have no entity of their own: inline handlers are read from the source text (dotted hops) and are less certain.',
  'Only calls written in the code are shown, not what happens at runtime (data, configuration, timing).',
];
