import { useEffect, useState } from 'react';
import Card from '../components/Card';

type FdaEvent = any;

const REDIRECT_TEMPLATES: Record<string, (q: string) => string> = {
  'Drugs.com': (q) => `https://www.drugs.com/search.php?searchterm=${encodeURIComponent(q)}`,
  'GoodRx': (q) => `https://www.goodrx.com/${encodeURIComponent(q)}`,
  'Amazon': (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  'Walgreens': (q) => `https://www.walgreens.com/search/results.jsp?Ntt=${encodeURIComponent(q)}`,
  'CVS': (q) => `https://www.cvs.com/search?query=${encodeURIComponent(q)}`,
};

const RECENT_KEY = 'orders_recent_searches';

const Orders = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FdaEvent[]>([]);
  const [selectedRedirect, setSelectedRedirect] = useState<string>('Drugs.com');
  const [previewEvent, setPreviewEvent] = useState<FdaEvent | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  const fdaKey = (import.meta as any).env?.VITE_FDA_API_KEY || '';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY) || '[]';
      setRecent(JSON.parse(raw));
    } catch {
      setRecent([]);
    }
  }, []);

  const saveRecent = (q: string) => {
    try {
      const list = [q, ...recent.filter(r => r !== q)].slice(0, 8);
      setRecent(list);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {}
  };

  const handleSearch = async (limit = 5) => {
    setError(null);
    setResults([]);
    if (!query || query.trim().length === 0) {
      setError('Please enter a medicine name to search.');
      return;
    }
    setLoading(true);
    try {
      // search by medicinal product name or openfda.brand_name
      const q = encodeURIComponent(`patient.drug.medicinalproduct:${query} OR patient.drug.openfda.brand_name:${query}`);
      const base = `https://api.fda.gov/drug/event.json?search=${q}&limit=${limit}`;
      const url = fdaKey ? `${base}&api_key=${encodeURIComponent(fdaKey)}` : base;

      const resp = await fetch(url);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`FDA API error: ${resp.status} ${text}`);
      }
      const data = await resp.json();
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        setResults(data.results);
        saveRecent(query);
      } else {
        setError('No events found for that medicine.');
      }
    } catch (err: any) {
      console.error('FDA fetch failed', err);
      setError(err?.message || 'Failed to fetch from FDA');
    } finally {
      setLoading(false);
    }
  };

  const handleOrder = (medName?: string) => {
    const target = selectedRedirect || 'Drugs.com';
    const q = (medName || query || '').trim();
    if (!q) return;
    const url = REDIRECT_TEMPLATES[target](q);
    window.open(url, '_blank');
  };

  const formatReceivedDate = (d: any) => {
    if (!d && d !== 0) return 'N/A';
    const s = String(d);
    // FDA often returns dates as YYYYMMDD (e.g. "20230115")
    if (/^\d{8}$/.test(s)) {
      return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`;
    }
    // Fallback: try ISO / timestamp parsing
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString().slice(0,10);
    }
    // If all else fails, return the raw string
    return s;
  };

  // Helper to render a single FDA event with actions
  const renderFdaEvent = (e: FdaEvent) => {
    if (!e) return null;
    const drug = (e.patient?.drug && e.patient.drug[0]) || null;
    const openfda = drug?.openfda || {};
    const medName = drug?.medicinalproduct || openfda.brand_name?.[0] || query;
    const manufacturer = openfda.manufacturer_name?.[0] || drug?.drugmanufacturername || 'Unknown';
    const received = formatReceivedDate(e.receivedate);
    const reactions = Array.isArray(e.patient?.reaction)
      ? e.patient.reaction.map((r: any) => r?.reactionmeddrapt || 'Unknown').slice(0,6)
      : [];
    const safetyId = e.safetyreportid || 'N/A';

    return (
      <div className="p-4 border border-gray-200 rounded-lg mb-3 hover:border-blue-300 hover:shadow-md transition-all bg-white">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-semibold text-gray-900">{medName}</h4>
            <p className="text-xs text-gray-600">Manufacturer: {manufacturer}</p>
            <p className="text-xs text-gray-600">Report date: {received} · Case ID: {safetyId}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <button onClick={() => handleOrder(medName)} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-sm hover:shadow-md">Order</button>
              <button onClick={() => setPreviewEvent(e)} className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">Preview</button>
            </div>
            <button onClick={() => { const apiUrl = `https://api.fda.gov/drug/event.json?search=safetyreportid:${encodeURIComponent(safetyId)}&limit=1`; window.open(apiUrl, '_blank'); }} className="text-xs text-blue-600 hover:text-blue-700 underline">View FDA JSON</button>
          </div>
        </div>
        {reactions.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900">Reported reactions:</p>
            <ul className="list-disc list-inside text-sm text-gray-700">
              {reactions.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 text-gray-900">Medicine Orders</h2>
      <Card>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">Search FDA adverse event reports for a medicine and open an external ordering page.</p>
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none text-gray-900"
              placeholder="Enter medicine name (e.g. levodopa)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            />
            <select value={selectedRedirect} onChange={(e) => setSelectedRedirect(e.target.value)} className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              {Object.keys(REDIRECT_TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <button onClick={() => handleSearch(5)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-md hover:shadow-lg" disabled={loading}>
              {loading ? 'Searching...' : 'Search FDA'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button key={r} onClick={() => { setQuery(r); handleSearch(); }} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-700 transition-colors">{r}</button>
            ))}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>
          )}

          {results.length > 0 ? (
            <div className="mt-4">
              {results.map((r, i) => (
                <div key={i}>{renderFdaEvent(r)}</div>
              ))}
            </div>
          ) : (
            <div className="text-center p-6">
              <p className="text-gray-600">No result yet. Enter a medicine and click "Search FDA".</p>
            </div>
          )}
        </div>
      </Card>

      {previewEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <Card className="max-w-3xl w-full m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Event Preview</h3>
              <button onClick={() => setPreviewEvent(null)} className="text-gray-600 hover:text-gray-900 px-3 py-1 rounded hover:bg-gray-100 transition-colors">Close</button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh] bg-gray-50 rounded-lg">
              <pre className="text-xs whitespace-pre-wrap text-gray-800">{JSON.stringify(previewEvent, null, 2)}</pre>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Orders;
