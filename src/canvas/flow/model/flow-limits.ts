/**
 * What a static trace cannot see, in plain words (the "this trace cannot see…" disclosure). The first
 * entries are always true of the indexer (see the Flow backend spec, "What the extractors cannot see");
 * the trace's own `notes` come first when it has any, because they describe this very trace.
 */
export const FLOW_BLIND_SPOTS: readonly string[] = [
  'Calls made through an object instance (`obj.method()`) are often missing: the index does not know the object\'s type.',
  'Handlers passed as arguments, JSX children and template event bindings are not followed.',
  'Imports through package.json "#alias" paths are not resolved, so a flow can stop at an alias.',
  'Which implementation of an interface or override runs depends on the object at runtime: such hops are drawn amber with their candidates.',
  'Anonymous callbacks have no entity of their own: inline handlers are read from the source text (dotted hops) and are less certain.',
  'Only calls written in the code are shown, not what happens at runtime (data, configuration, timing).',
];
