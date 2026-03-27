// Cognitive: 0, Cyclomatic: 1
export function trivial() {
  return 1;
}

// Cognitive: 1, Cyclomatic: 2
export function simpleIf(x: boolean) {
  if (x) {
    return 1;
  }
  return 0;
}

// Cognitive: 7 (the spec reference example)
export function specExample(a: boolean, b: boolean, items: number[]) {
  if (a) {                    // +1 (cognitive), nesting=1
    for (const item of items) {  // +2 (cognitive, nesting=1), nesting=2
      if (item > 0) {           // +3 (cognitive, nesting=2)
        console.log(item);
      } else if (b) {          // +1 (cognitive, else-if no nesting penalty)
        console.log('b');
      }
    }
  }
}

// Cognitive: 10 — deeply nested
export function deepNesting(a: boolean, items: number[]) {
  if (a) {                       // +1, nesting=1
    for (const x of items) {     // +2, nesting=2
      if (x > 0) {              // +3, nesting=3
        while (true) { break; } // +4, nesting=4
      }
    }
  }
}
