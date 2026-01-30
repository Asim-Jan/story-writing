/**
 * Stripe Integration Service
 *
 * PLACEHOLDER for future Stripe payment integration
 * This file outlines the structure for Stripe webhook handling and payment processing
 *
 * To implement:
 * 1. Install Stripe SDK: npm install stripe
 * 2. Add environment variables:
 *    - STRIPE_SECRET_KEY
 *    - STRIPE_WEBHOOK_SECRET
 *    - STRIPE_PRICE_BASIC_MONTHLY
 *    - STRIPE_PRICE_BASIC_ANNUAL
 *    - STRIPE_PRICE_PREMIUM_MONTHLY
 *    - STRIPE_PRICE_PREMIUM_ANNUAL
 * 3. Implement the functions below
 * 4. Add webhook endpoint in server/index.js
 */

/**
 * Handle Stripe webhook events
 *
 * Events to handle:
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 * - checkout.session.completed
 *
 * @param {Object} event - Stripe webhook event
 * @returns {Promise<void>}
 */
export async function handleStripeWebhook(event) {
  // TODO: Implement webhook handler
  console.log('Stripe webhook received:', event.type);

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      // Update user tier based on subscription
      // const { customer, items, status } = event.data.object;
      // const userId = await getUserIdByStripeCustomer(customer);
      // const tier = mapStripePlanToTier(items.data[0].price.id);
      //
      // if (status === 'active') {
      //   await UserRepository.updateTier(userId, tier, 'stripe-webhook');
      // }
      break;

    case 'customer.subscription.deleted':
      // Downgrade user to free tier
      // const { customer } = event.data.object;
      // const userId = await getUserIdByStripeCustomer(customer);
      // await UserRepository.updateTier(userId, 'free', 'stripe-webhook');
      break;

    case 'invoice.payment_succeeded':
      // Extend subscription, send receipt email
      // const { customer, subscription } = event.data.object;
      break;

    case 'invoice.payment_failed':
      // Handle payment failure
      // - Send email notification
      // - Start grace period (7-14 days)
      // - If grace period expires, downgrade to free
      break;

    case 'checkout.session.completed':
      // Handle successful checkout
      // - Update user tier
      // - Send welcome email
      // const session = event.data.object;
      // const userId = session.metadata.userId;
      // const tier = session.metadata.tier;
      // await UserRepository.updateTier(userId, tier, 'stripe-checkout');
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

/**
 * Map Stripe price IDs to tier names
 *
 * @param {string} priceId - Stripe price ID
 * @returns {string} Tier name (free, basic, premium)
 */
export function mapStripePlanToTier(priceId) {
  // TODO: Replace with actual Stripe price IDs from environment
  const priceMap = {
    // Basic tier
    'price_basic_monthly': 'basic',
    'price_basic_annual': 'basic',

    // Premium tier
    'price_premium_monthly': 'premium',
    'price_premium_annual': 'premium',
  };

  return priceMap[priceId] || 'free';
}

/**
 * Create Stripe checkout session for tier upgrade
 *
 * @param {string} userId - User UUID
 * @param {string} tier - Target tier (basic, premium)
 * @param {string} billingPeriod - Billing period (monthly, annual)
 * @returns {Promise<{sessionId: string, url: string}>} Checkout session info
 */
export async function createCheckoutSession(userId, tier, billingPeriod = 'monthly') {
  // TODO: Implement Stripe checkout session creation
  //
  // import Stripe from 'stripe';
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  //
  // const priceId = getPriceId(tier, billingPeriod);
  //
  // const session = await stripe.checkout.sessions.create({
  //   mode: 'subscription',
  //   payment_method_types: ['card'],
  //   line_items: [{
  //     price: priceId,
  //     quantity: 1,
  //   }],
  //   success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
  //   cancel_url: `${process.env.CLIENT_URL}/pricing`,
  //   metadata: {
  //     userId,
  //     tier,
  //   },
  //   customer_email: user.email, // Get from database
  // });
  //
  // return {
  //   sessionId: session.id,
  //   url: session.url
  // };

  throw new Error('Stripe integration not yet implemented');
}

/**
 * Get Stripe price ID based on tier and billing period
 *
 * @param {string} tier - Tier (basic, premium)
 * @param {string} billingPeriod - Billing period (monthly, annual)
 * @returns {string} Stripe price ID
 */
function getPriceId(tier, billingPeriod) {
  // TODO: Replace with actual environment variables
  const prices = {
    basic: {
      monthly: process.env.STRIPE_PRICE_BASIC_MONTHLY || 'price_basic_monthly',
      annual: process.env.STRIPE_PRICE_BASIC_ANNUAL || 'price_basic_annual',
    },
    premium: {
      monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY || 'price_premium_monthly',
      annual: process.env.STRIPE_PRICE_PREMIUM_ANNUAL || 'price_premium_annual',
    },
  };

  return prices[tier]?.[billingPeriod] || null;
}

/**
 * Cancel user subscription
 *
 * @param {string} userId - User UUID
 * @returns {Promise<void>}
 */
export async function cancelSubscription(userId) {
  // TODO: Implement subscription cancellation
  //
  // import Stripe from 'stripe';
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  //
  // const user = await UserRepository.findById(userId);
  // const subscriptionId = user.stripe_subscription_id; // Add this field to users table
  //
  // await stripe.subscriptions.cancel(subscriptionId);
  //
  // // Downgrade to free at period end
  // await UserRepository.updateTier(userId, 'free', 'subscription-cancelled');

  throw new Error('Stripe integration not yet implemented');
}

/**
 * Get user's billing portal URL
 *
 * @param {string} userId - User UUID
 * @returns {Promise<string>} Billing portal URL
 */
export async function getBillingPortalUrl(userId) {
  // TODO: Implement billing portal URL generation
  //
  // import Stripe from 'stripe';
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  //
  // const user = await UserRepository.findById(userId);
  // const customerId = user.stripe_customer_id; // Add this field to users table
  //
  // const session = await stripe.billingPortal.sessions.create({
  //   customer: customerId,
  //   return_url: `${process.env.CLIENT_URL}/settings`,
  // });
  //
  // return session.url;

  throw new Error('Stripe integration not yet implemented');
}

/**
 * Example webhook endpoint to add to server/index.js:
 *
 * import Stripe from 'stripe';
 * import { handleStripeWebhook } from './services/stripe.js';
 *
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
 *
 * app.post('/api/webhooks/stripe',
 *   express.raw({ type: 'application/json' }),
 *   async (req, res) => {
 *     const sig = req.headers['stripe-signature'];
 *     let event;
 *
 *     try {
 *       event = stripe.webhooks.constructEvent(
 *         req.body,
 *         sig,
 *         process.env.STRIPE_WEBHOOK_SECRET
 *       );
 *     } catch (err) {
 *       console.error('Webhook signature verification failed:', err.message);
 *       return res.status(400).send(`Webhook Error: ${err.message}`);
 *     }
 *
 *     await handleStripeWebhook(event);
 *     res.json({ received: true });
 *   }
 * );
 */
