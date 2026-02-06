import Stripe from 'stripe';
import pkg from 'pg';
const { Pool } = pkg;

const stripe = new Stripe('sk_test_51SwljiReFoIBAm6QwjxOePiqUiK91bPKDjMf1bJ0yI8pC2ULsy2PrejtFUKTPc2udmx7TovlNP3bHg8VmOV2hCLT00rlVe9Res');

// Database connection
const pool = new Pool({
  host: 'story-writing-postgres.cxsu2memgs31.eu-west-2.rds.amazonaws.com',
  port: 5432,
  database: 'story_writing',
  user: 'story_user',
  password: process.env.POSTGRES_PASSWORD || 'POSTGRES_PASSWORD_HERE',
  ssl: { rejectUnauthorized: false }
});

function getTierQuotas(tier) {
  const quotas = {
    free: {
      max_books: 3,
      max_words: 10000,
      max_chapters: 10,
      max_ai_requests_per_day: 10,
      max_concurrent_jobs: 1
    },
    basic: {
      max_books: 10,
      max_words: 100000,
      max_chapters: 100,
      max_ai_requests_per_day: 100,
      max_concurrent_jobs: 3
    },
    premium: {
      max_books: 999999,
      max_words: 999999999,
      max_chapters: 999999,
      max_ai_requests_per_day: 999999,
      max_concurrent_jobs: 10
    }
  };
  return quotas[tier] || quotas.free;
}

async function syncSubscriptions() {
  try {
    console.log('Fetching active subscriptions from Stripe...\n');

    // Get all subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    console.log(`Found ${subscriptions.data.length} active subscriptions\n`);

    for (const sub of subscriptions.data) {
      // Get customer details
      const customer = await stripe.customers.retrieve(sub.customer);
      const email = customer.email;

      console.log(`Processing subscription for ${email}...`);

      // Find user in database
      const userResult = await pool.query(
        'SELECT id, tier FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        console.log(`  ⚠️  User not found: ${email}`);
        continue;
      }

      const user = userResult.rows[0];

      // Determine tier from price
      let tier = 'basic';
      const priceId = sub.items.data[0].price.id;
      if (priceId === 'price_1SxE5UReFoIBAm6QEOR5l0FJ') {
        tier = 'premium';
      }

      // Check if subscription exists in DB
      const subResult = await pool.query(
        'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1',
        [sub.id]
      );

      if (subResult.rows.length === 0) {
        // Create subscription record
        // Use NOW() if period dates are not set yet
        const periodStart = sub.current_period_start ? `to_timestamp(${sub.current_period_start})` : 'NOW()';
        const periodEnd = sub.current_period_end ? `to_timestamp(${sub.current_period_end})` : "NOW() + INTERVAL '30 days'";

        await pool.query(
          `INSERT INTO subscriptions
           (user_id, stripe_subscription_id, stripe_customer_id, tier, status,
            current_period_start, current_period_end, cancel_at_period_end)
           VALUES ($1, $2, $3, $4, $5, ${periodStart}, ${periodEnd}, $6)`,
          [
            user.id,
            sub.id,
            sub.customer,
            tier,
            sub.status,
            sub.cancel_at_period_end
          ]
        );
        console.log(`  ✓ Created subscription record`);
      } else {
        // Update existing subscription
        const periodStart = sub.current_period_start ? `to_timestamp(${sub.current_period_start})` : 'NOW()';
        const periodEnd = sub.current_period_end ? `to_timestamp(${sub.current_period_end})` : "NOW() + INTERVAL '30 days'";

        await pool.query(
          `UPDATE subscriptions
           SET status = $1, tier = $2,
               current_period_start = ${periodStart},
               current_period_end = ${periodEnd},
               cancel_at_period_end = $3,
               updated_at = NOW()
           WHERE stripe_subscription_id = $4`,
          [
            sub.status,
            tier,
            sub.cancel_at_period_end,
            sub.id
          ]
        );
        console.log(`  ✓ Updated subscription record`);
      }

      // Update user tier if different
      if (user.tier !== tier) {
        await pool.query(
          'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2',
          [tier, user.id]
        );
        console.log(`  ✓ Updated user tier: ${user.tier} → ${tier}`);
      }

      // Update quotas
      const tierQuotas = getTierQuotas(tier);
      await pool.query(
        `UPDATE quotas
         SET max_books = $1, max_words = $2, max_chapters = $3,
             max_ai_requests_per_day = $4, max_concurrent_jobs = $5,
             custom_quotas = false, updated_at = NOW()
         WHERE user_id = $6`,
        [
          tierQuotas.max_books,
          tierQuotas.max_words,
          tierQuotas.max_chapters,
          tierQuotas.max_ai_requests_per_day,
          tierQuotas.max_concurrent_jobs,
          user.id
        ]
      );
      console.log(`  ✓ Updated quotas to ${tier} tier\n`);
    }

    console.log('✅ Sync complete!');
    await pool.end();

  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

syncSubscriptions();
