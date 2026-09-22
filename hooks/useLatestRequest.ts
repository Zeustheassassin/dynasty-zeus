import { useCallback, useRef } from "react";

/** Guards an async handler against out-of-order commits: overlapping calls (rapid
 *  re-triggers, a manual refresh racing a mount-time load) can resolve in any order,
 *  and only the most recently started one may apply its result. Call `begin()` once
 *  per invocation to get a token, then gate every post-await commit with `isCurrent`. */
export function useLatestRequest() {
  const seqRef = useRef(0);
  const begin = useCallback(() => ++seqRef.current, []);
  const isCurrent = useCallback((token: number) => token === seqRef.current, []);
  return { begin, isCurrent };
}
