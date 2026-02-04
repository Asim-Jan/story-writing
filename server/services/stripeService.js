import Stripe from 'stripe';

let stripe;

/**
 * Initialize Stripe SDK with secret key
 */
export function initializeStripe() {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16',
    });
  }
  return stripe;
}

/**
 * Get Stripe instance (initialize if needed)
 */
export function getStripe() {
  if (!stripe) {
    initializeStripe();
  }
  return stripe;
}

/**
 * Create a Stripe customer
 * @param {string} email - Customer email
 * @param {string} name - Customer name
 * @returns {Promise<Stripe.Customer>}
 */
export async function createCustomer(email, name) {
  const stripe = getStripe();

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      source: 'story-writing-studio'
    }
  });

  return customer;
}

/**
 * Create a Stripe checkout session for subscription
 * @param {string} customerId - Stripe customer ID
 * @param {string} priceId - Stripe price ID
 * @param {string} tier - Subscription tier (basic/premium)
 * @param {string} successUrl - URL to redirect on success
 * @param {string} cancelUrl - URL to redirect on cancel
 * @param {object} metadata - Additional metadata
 * @returns {Promise<Stripe.Checkout.Session>}
 */
export async function createCheckoutSession(customerId, priceId, tier, successUrl, cancelUrl, metadata = {}) {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tier,
      ...metadata
    },
    subscription_data: {
      metadata: {
        tier,
        ...metadata
      }
    }
  });

  return session;
}

/**
 * Cancel a subscription (at period end by default)
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {boolean} immediately - Cancel immediately or at period end
 * @returns {Promise<Stripe.Subscription>}
 */
export async function cancelSubscription(subscriptionId, immediately = false) {
  const stripe = getStripe();

  if (immediately) {
    // Cancel immediately
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  } else {
    // Cancel at period end
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });
    return subscription;
  }
}

/**
 * Reactivate a canceled subscription (remove cancel_at_period_end)
 * @param {string} subscriptionId - Stripe subscription ID
 * @returns {Promise<Stripe.Subscription>}
 */
export async function reactivateSubscription(subscriptionId) {
  const stripe = getStripe();

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false
  });

  return subscription;
}

/**
 * Update a subscription to a new price (upgrade/downgrade)
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {string} newPriceId - New Stripe price ID
 * @returns {Promise<Stripe.Subscription>}
 */
export async function updateSubscription(subscriptionId, newPriceId) {
  const stripe = getStripe();

  // Get current subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Update to new price
  const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: newPriceId,
      }
    ],
    proration_behavior: 'create_prorations', // Prorate the change
  });

  return updatedSubscription;
}

/**
 * Retrieve a subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @returns {Promise<Stripe.Subscription>}
 */
export async function retrieveSubscription(subscriptionId) {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return subscription;
}

/**
 * Create a refund for a payment
 * @param {string} paymentIntentId - Stripe payment intent ID
 * @param {number} amount - Amount to refund in cents (optional, full refund if not specified)
 * @param {string} reason - Refund reason
 * @returns {Promise<Stripe.Refund>}
 */
export async function createRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
  const stripe = getStripe();

  const refundData = {
    payment_intent: paymentIntentId,
    reason
  };

  if (amount !== null) {
    refundData.amount = amount;
  }

  const refund = await stripe.refunds.create(refundData);
  return refund;
}

/**
 * Construct and verify a webhook event
 * @param {string|Buffer} payload - Raw webhook payload
 * @param {string} signature - Stripe signature header
 * @returns {Stripe.Event}
 */
export function constructWebhookEvent(payload, signature) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
    return event;
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}

/**
 * Get price IDs from environment
 * @returns {object} Price IDs for basic and premium tiers
 */
export function getPriceIds() {
  return {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    premium: process.env.STRIPE_PRICE_ID_PREMIUM
  };
}

/**
 * Get price ID for a specific tier
 * @param {string} tier - Tier name (basic/premium)
 * @returns {string} Stripe price ID
 */
export function getPriceIdForTier(tier) {
  const priceIds = getPriceIds();

  if (tier === 'basic') {
    return priceIds.basic;
  } else if (tier === 'premium') {
    return priceIds.premium;
  } else {
    throw new Error(`Invalid tier: ${tier}`);
  }
}
