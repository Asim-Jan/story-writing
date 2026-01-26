import { createClient } from 'redis';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

const getUserEmailKey = (email) => `user:email:${email}`;
const getUserKey = (userId) => `user:${userId}`;

async function createUser(email, password, name) {
  try {
    await redisClient.connect();

    // Check if user already exists
    const existingUserId = await redisClient.get(getUserEmailKey(email));

    if (existingUserId) {
      console.log(`User already exists with email: ${email}`);
      console.log('Updating password...');

      const userData = await redisClient.get(getUserKey(existingUserId));
      const user = JSON.parse(userData);

      // Update password
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;

      await redisClient.set(getUserKey(existingUserId), JSON.stringify(user));
      console.log(`✅ Password updated for ${email}`);
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const user = {
        id: userId,
        email,
        name,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        books: []
      };

      await redisClient.set(getUserKey(userId), JSON.stringify(user));
      await redisClient.set(getUserEmailKey(email), userId);

      console.log(`✅ Created new user: ${email}`);
    }

    await redisClient.quit();
  } catch (error) {
    console.error('Error:', error);
    await redisClient.quit();
  }
}

// Get credentials from command line
const email = process.argv[2] || 'Asim_j1@hotmail.com';
const password = process.argv[3] || 'password123';
const name = process.argv[4] || 'Asim';

console.log(`Creating/updating user: ${email}`);
createUser(email, password, name);
