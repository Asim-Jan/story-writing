import Stripe from 'stripe';

const stripe = new Stripe('sk_test_51SwljiReFoIBAm6QwjxOePiqUiK91bPKDjMf1bJ0yI8pC2ULsy2PrejtFUKTPc2udmx7TovlNP3bHg8VmOV2hCLT00rlVe9Res');

async function createGBPPrices() {
  try {
    console.log('Creating GBP prices for existing products...\n');

    // Get existing products
    const products = await stripe.products.list();
    const basicProduct = products.data.find(p => p.name.includes('Basic'));
    const premiumProduct = products.data.find(p => p.name.includes('Premium'));

    if (!basicProduct || !premiumProduct) {
      console.error('Products not found! Please run setup-stripe-products.js first');
      process.exit(1);
    }

    // Create GBP price for Basic
    const basicPriceGBP = await stripe.prices.create({
      product: basicProduct.id,
      unit_amount: 999, // £9.99 in pence
      currency: 'gbp',
      recurring: {
        interval: 'month',
      },
    });
    console.log('✓ Created Basic GBP price:', basicPriceGBP.id);
    console.log('  Amount: £9.99/month\n');

    // Create GBP price for Premium
    const premiumPriceGBP = await stripe.prices.create({
      product: premiumProduct.id,
      unit_amount: 1999, // £19.99 in pence
      currency: 'gbp',
      recurring: {
        interval: 'month',
      },
    });
    console.log('✓ Created Premium GBP price:', premiumPriceGBP.id);
    console.log('  Amount: £19.99/month\n');

    // Print environment variables
    console.log('='.repeat(60));
    console.log('Updated Environment Variables for ECS:');
    console.log('='.repeat(60));
    console.log('STRIPE_SECRET_KEY=sk_test_51SwljiReFoIBAm6QwjxOePiqUiK91bPKDjMf1bJ0yI8pC2ULsy2PrejtFUKTPc2udmx7TovlNP3bHg8VmOV2hCLT00rlVe9Res');
    console.log(`STRIPE_PRICE_ID_BASIC=${basicPriceGBP.id}`);
    console.log(`STRIPE_PRICE_ID_PREMIUM=${premiumPriceGBP.id}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createGBPPrices();
