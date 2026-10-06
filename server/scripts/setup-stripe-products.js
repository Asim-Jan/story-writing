import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

async function setupProducts() {
  try {
    console.log('Creating Stripe products and prices...\n');

    // Create Basic Product
    const basicProduct = await stripe.products.create({
      name: 'Story Writing Studio - Basic',
      description: 'Basic plan with 10 books, 100K words, 100 chapters per book, 100 AI requests/day',
    });
    console.log('✓ Created Basic product:', basicProduct.id);

    // Create Basic Price
    const basicPrice = await stripe.prices.create({
      product: basicProduct.id,
      unit_amount: 999, // $9.99 in cents
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
    });
    console.log('✓ Created Basic price:', basicPrice.id);
    console.log('  Amount: $9.99/month\n');

    // Create Premium Product
    const premiumProduct = await stripe.products.create({
      name: 'Story Writing Studio - Premium',
      description: 'Premium plan with unlimited books, words, chapters, and AI requests',
    });
    console.log('✓ Created Premium product:', premiumProduct.id);

    // Create Premium Price
    const premiumPrice = await stripe.prices.create({
      product: premiumProduct.id,
      unit_amount: 1999, // $19.99 in cents
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
    });
    console.log('✓ Created Premium price:', premiumPrice.id);
    console.log('  Amount: $19.99/month\n');

    // Print environment variables
    console.log('='.repeat(60));
    console.log('Environment Variables for ECS:');
    console.log('='.repeat(60));
    console.log('STRIPE_SECRET_KEY=<from your environment>');
    console.log(`STRIPE_PRICE_ID_BASIC=${basicPrice.id}`);
    console.log(`STRIPE_PRICE_ID_PREMIUM=${premiumPrice.id}`);
    console.log('STRIPE_WEBHOOK_SECRET=(will be set after webhook is created)');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

setupProducts();
