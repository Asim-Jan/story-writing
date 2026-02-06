import Stripe from 'stripe';

const stripe = new Stripe('sk_test_51SwljiReFoIBAm6QwjxOePiqUiK91bPKDjMf1bJ0yI8pC2ULsy2PrejtFUKTPc2udmx7TovlNP3bHg8VmOV2hCLT00rlVe9Res');

async function checkSubscriptions() {
  try {
    const subscriptions = await stripe.subscriptions.list({
      limit: 10,
    });

    console.log(`Found ${subscriptions.data.length} subscriptions:\n`);

    for (const sub of subscriptions.data) {
      console.log('Subscription:', sub.id);
      console.log('  Customer:', sub.customer);
      console.log('  Status:', sub.status);
      console.log('  Current period start:', sub.current_period_start);
      console.log('  Current period end:', sub.current_period_end);
      console.log('  Cancel at period end:', sub.cancel_at_period_end);
      console.log('  Price ID:', sub.items.data[0]?.price.id);
      console.log('  Amount:', sub.items.data[0]?.price.unit_amount / 100);

      // Get customer email
      const customer = await stripe.customers.retrieve(sub.customer);
      console.log('  Customer email:', customer.email);
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSubscriptions();
