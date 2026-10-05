import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

async function createWebhook() {
  try {
    console.log('Creating Stripe webhook endpoint...\n');

    const webhook = await stripe.webhookEndpoints.create({
      url: 'https://story-writing.com/api/webhooks/stripe',
      enabled_events: [
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
      ],
    });

    console.log('✓ Webhook created successfully!');
    console.log('  URL:', webhook.url);
    console.log('  Status:', webhook.status);
    console.log('\n' + '='.repeat(60));
    console.log('Webhook Secret (add to ECS):');
    console.log('='.repeat(60));
    console.log(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createWebhook();
