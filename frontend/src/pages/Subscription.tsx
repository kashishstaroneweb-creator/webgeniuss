import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Check, Sparkles } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price: number;
  features: string[];
}

const Subscription = () => {
  const { user, updateUser } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await api.get('/subscription/list');
      setPlans(response.data);
    } catch (error) {
      console.error('Failed to fetch plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planName: string) => {
    try {
      const res = await api.post('/subscription/upgrade', { planType: planName.toLowerCase() });
      updateUser({
        subscriptionPlan: planName.toLowerCase(),
        creditsBalance: res.data?.creditsBalance,
        creditsUsed: res.data?.creditsUsed,
      });
      alert(`Upgraded to ${planName} plan!`);
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to upgrade plan');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl mb-4">
            Subscription Plans
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Choose the plan that best fits your needs
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading plans...</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan) => {
              const isCurrentPlan = user?.subscriptionPlan?.toLowerCase() === plan.name.toLowerCase();
              return (
                <Card
                  key={plan.id}
                  className={`transition-all duration-200 ${
                    isCurrentPlan ? 'border-accent/30 bg-accent/5 border-2' : ''
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between mb-2">
                      <CardTitle>{plan.name}</CardTitle>
                      {isCurrentPlan && <Sparkles className="h-5 w-5 text-accent" />}
                    </div>
                    <div className="text-3xl font-bold">
                      ${plan.price}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </div>
                    <CardDescription>Perfect for {plan.name.toLowerCase()} users</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                          <Check className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                            isCurrentPlan ? 'text-accent' : 'text-muted-foreground'
                          }`} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full transition-all duration-200"
                      variant={isCurrentPlan ? 'outline' : 'default'}
                      disabled={isCurrentPlan}
                      onClick={() => handleUpgrade(plan.name)}
                    >
                      {isCurrentPlan ? 'Current Plan' : 'Upgrade'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Subscription;

