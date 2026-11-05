import { useCallback, useEffect, useState } from 'react';
import { clearParkedCar, loadParkedCar, ParkedCar, saveParkedCar } from '../_services/parkedCar';

export function useParkedCar() {
  const [car, setCar] = useState<ParkedCar | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadParkedCar().then(loaded => {
      if (!cancelled) setCar(loaded);
    });
    return () => { cancelled = true; };
  }, []);

  const remember = useCallback(async (next: Omit<ParkedCar, 'savedAt'>) => {
    const stored = await saveParkedCar(next);
    setCar(stored);
  }, []);

  const forget = useCallback(async () => {
    await clearParkedCar();
    setCar(null);
  }, []);

  return { car, remember, forget };
}
