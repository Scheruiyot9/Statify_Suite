import AppRouter from './app/router';
import LockScreen from '@/features/lock/LockScreen';

export default function App() {
  return (
    <>
      <AppRouter />
      <LockScreen />
    </>
  );
}
