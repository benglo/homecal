import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { nowBne } from '../util/time';

/** Brisbane wall clock, ticking every second. The always-alive signal. */
export function useClock(): DateTime {
  const [t, setT] = useState(nowBne);
  useEffect(() => {
    const id = setInterval(() => setT(nowBne()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}
