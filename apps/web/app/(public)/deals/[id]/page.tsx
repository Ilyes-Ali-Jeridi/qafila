import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';

export default function Page() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Deal</h1>
      <ApiScreen path="/deals/_" schema={z.unknown()} render={(d) => <pre className="text-xs">{JSON.stringify(d, null, 2)}</pre>} />
    </div>
  );
}
