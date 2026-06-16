import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Coins,
  Image,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  UserCog,
  Users,
  XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

type AdminTab = 'overview' | 'users' | 'generations' | 'ledger';

interface AdminDashboard {
  totals: {
    users: number;
    activeUsers: number;
    websites: number;
    generations: number;
    todayGenerations: number;
    successfulGenerations: number;
    failedGenerations: number;
    inProgressGenerations: number;
    successRate: number;
    creditsConsumed: number;
    creditsGranted: number;
    adminAdjustments: number;
    subscriptionGrants: number;
    netCredits: number;
    remainingUserCredits: number;
    imageGenerations: number;
    avgDurationMs: number;
  };
  byFramework: Record<string, number>;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  recentGenerations: GenerationUsage[];
  topUsers: AdminUser[];
  recentLedger: CreditLedgerRow[];
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  roleName?: string;
  subscriptionPlan?: string;
  creditsBalance: number;
  creditsUsed: number;
  accountStatus?: string;
  createdAt?: string;
}

interface GenerationUsage {
  id?: string;
  userId: string;
  websiteId?: string;
  kind: 'generate' | 'edit';
  promptPreview?: string;
  framework?: string;
  imageAttached: boolean;
  status: 'started' | 'success' | 'failed';
  estimatedCostCredits: number;
  actualCostCredits?: number;
  v0ChatId?: string;
  durationMs?: number;
  errorMessage?: string;
  startedAt?: string;
}

interface CreditLedgerRow {
  id?: string;
  userId: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason?: string;
  createdBy?: string;
  createdAt?: string;
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="rounded-2xl py-5">
      <CardContent className="flex items-center justify-between gap-4 px-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
          {detail ? <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        status === 'success' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
        status === 'failed' && 'border-red-400/25 bg-red-400/10 text-red-300',
        status === 'started' && 'border-amber-400/25 bg-amber-400/10 text-amber-200',
        status === 'active' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
        status === 'suspended' && 'border-red-400/25 bg-red-400/10 text-red-300',
      )}
    >
      {status}
    </span>
  );
}

const formatDuration = (ms?: number) => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [generations, setGenerations] = useState<GenerationUsage[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [adjustingUser, setAdjustingUser] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState(10);
  const [creditReason, setCreditReason] = useState('Manual admin credit adjustment');

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [dashboardRes, usersRes, generationsRes, ledgerRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/users'),
        api.get('/admin/generations'),
        api.get('/admin/ledger'),
      ]);
      setDashboard(dashboardRes.data);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setGenerations(Array.isArray(generationsRes.data) ? generationsRes.data : []);
      setLedger(Array.isArray(ledgerRes.data) ? ledgerRes.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.email, user.roleName, user.subscriptionPlan].some((item) =>
        String(item || '').toLowerCase().includes(needle),
      ),
    );
  }, [query, users]);

  const filteredGenerations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return generations;
    return generations.filter((item) =>
      [item.userId, item.websiteId, item.promptPreview, item.framework, item.status, item.v0ChatId].some((value) =>
        String(value || '').toLowerCase().includes(needle),
      ),
    );
  }, [generations, query]);

  const handleAdjustCredits = async () => {
    if (!adjustingUser) return;
    await api.post(`/admin/users/${adjustingUser}/credits`, {
      amount: creditAmount,
      reason: creditReason,
    });
    setAdjustingUser(null);
    await loadAdminData();
  };

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'generations', label: 'Generations', icon: Activity },
    { id: 'ledger', label: 'Credit Ledger', icon: Coins },
  ];

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            WebGenius Command Center
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Admin Panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor users, generations, credits, and v0-linked operational health.
          </p>
        </div>
        <Button variant="outline" onClick={loadAdminData} disabled={loading} className="gap-2">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all',
                  activeTab === tab.id
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        {activeTab !== 'overview' ? (
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search admin data..."
              className="w-full rounded-xl border border-border bg-background/60 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-400/50"
            />
          </div>
        ) : null}
      </div>

      {activeTab === 'overview' && dashboard ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={dashboard.totals.users} detail={`${dashboard.totals.activeUsers} active`} icon={Users} />
            <StatCard label="Generations" value={dashboard.totals.generations} detail={`${dashboard.totals.successRate}% success rate`} icon={Activity} />
            <StatCard label="Credits Used" value={dashboard.totals.creditsConsumed} detail={`${dashboard.totals.remainingUserCredits} remaining liability`} icon={Coins} />
            <StatCard label="Avg Duration" value={formatDuration(dashboard.totals.avgDurationMs)} detail={`${dashboard.totals.imageGenerations} image-reference runs`} icon={Timer} />
            <StatCard label="Today" value={dashboard.totals.todayGenerations} detail={`${dashboard.totals.inProgressGenerations} running now`} icon={RefreshCw} />
            <StatCard label="Credits Granted" value={dashboard.totals.creditsGranted} detail={`${dashboard.totals.subscriptionGrants} from plans`} icon={CheckCircle2} />
            <StatCard label="Net Credits" value={dashboard.totals.netCredits} detail={`${dashboard.totals.adminAdjustments} admin adjustments`} icon={BarChart3} />
            <StatCard label="Failures" value={dashboard.totals.failedGenerations} detail={`${dashboard.totals.successfulGenerations} successful`} icon={XCircle} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-emerald-300" />
                  Framework Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(dashboard.byFramework || {}).map(([framework, count]) => (
                  <div key={framework}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="capitalize text-foreground">{framework}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.min(100, (count / Math.max(1, dashboard.totals.generations)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCog className="h-4 w-4 text-emerald-300" />
                  Top Credit Users
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {dashboard.topUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-emerald-300">{user.creditsUsed}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-emerald-300" />
                  Generation Mix
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {Object.entries(dashboard.byStatus || {}).map(([status, count]) => (
                  <div key={status} className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <p className="text-xs uppercase text-muted-foreground">{status}</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{count}</p>
                  </div>
                ))}
                {Object.entries(dashboard.byKind || {}).map(([kind, count]) => (
                  <div key={kind} className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <p className="text-xs uppercase text-muted-foreground">{kind}</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{count}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-4 w-4 text-emerald-300" />
                  Recent Credit Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(dashboard.recentLedger || []).map((item) => (
                  <div key={item.id || `${item.userId}-${item.createdAt}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{item.reason || item.type}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                    </div>
                    <span className={cn('shrink-0 text-sm font-semibold', item.amount >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                      {item.amount >= 0 ? '+' : ''}{item.amount}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <Card className="rounded-2xl">
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Plan</th>
                  <th className="px-5 py-3">Credits</th>
                  <th className="px-5 py-3">Used</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b border-border/40">
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{user.roleName || 'user'}</td>
                    <td className="px-5 py-3 text-muted-foreground">{user.subscriptionPlan || 'free'}</td>
                    <td className="px-5 py-3 font-medium text-emerald-300">{user.creditsBalance}</td>
                    <td className="px-5 py-3 text-muted-foreground">{user.creditsUsed}</td>
                    <td className="px-5 py-3"><StatusBadge status={user.accountStatus || 'active'} /></td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setAdjustingUser(user.id)}>
                        Adjust
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'generations' ? (
        <Card className="rounded-2xl">
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Prompt</th>
                  <th className="px-5 py-3">Kind</th>
                  <th className="px-5 py-3">Framework</th>
                  <th className="px-5 py-3">Image</th>
                  <th className="px-5 py-3">Credits</th>
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3">Started</th>
                </tr>
              </thead>
              <tbody>
                {filteredGenerations.map((item) => (
                  <tr key={item.id || `${item.userId}-${item.startedAt}`} className="border-b border-border/40">
                    <td className="px-5 py-3"><StatusBadge status={item.status} /></td>
                    <td className="max-w-[360px] px-5 py-3">
                      <p className="truncate text-foreground">{item.promptPreview || '-'}</p>
                      {item.errorMessage ? <p className="mt-1 truncate text-xs text-red-300">{item.errorMessage}</p> : null}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{item.kind}</td>
                    <td className="px-5 py-3 text-muted-foreground">{item.framework || '-'}</td>
                    <td className="px-5 py-3">
                      {item.imageAttached ? <Image className="h-4 w-4 text-emerald-300" /> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{item.actualCostCredits ?? item.estimatedCostCredits}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDuration(item.durationMs)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(item.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === 'ledger' ? (
        <Card className="rounded-2xl">
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Before</th>
                  <th className="px-5 py-3">After</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((item) => (
                  <tr key={item.id || `${item.userId}-${item.createdAt}`} className="border-b border-border/40">
                    <td className="px-5 py-3 text-muted-foreground">{item.type}</td>
                    <td className={cn('px-5 py-3 font-medium', item.amount >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                      {item.amount >= 0 ? '+' : ''}{item.amount}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{item.balanceBefore}</td>
                    <td className="px-5 py-3 text-muted-foreground">{item.balanceAfter}</td>
                    <td className="max-w-[360px] truncate px-5 py-3 text-muted-foreground">{item.reason || '-'}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {adjustingUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Adjust Credits</h2>
              <button
                type="button"
                onClick={() => setAdjustingUser(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-foreground">
                Amount
                <input
                  type="number"
                  value={creditAmount}
                  onChange={(event) => setCreditAmount(Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Reason
                <textarea
                  value={creditReason}
                  onChange={(event) => setCreditReason(event.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setAdjustingUser(null)}>Cancel</Button>
                <Button onClick={handleAdjustCredits} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {loading && !dashboard ? (
        <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
          Loading admin analytics...
        </div>
      ) : null}
    </div>
  );
}
