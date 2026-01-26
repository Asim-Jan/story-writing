import { createClient } from 'redis';
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
const getBookKey = (bookId) => `book:${bookId}`;

async function addBookToUser(email, bookId) {
  try {
    await redisClient.connect();

    // Get user ID from email
    const userId = await redisClient.get(getUserEmailKey(email));

    if (!userId) {
      console.log(`User not found with email: ${email}`);
      console.log('Please register first or check the email address');
      await redisClient.quit();
      return;
    }

    // Get user data
    const userData = await redisClient.get(getUserKey(userId));
    const user = JSON.parse(userData);

    // Check if book exists
    const bookData = await redisClient.get(getBookKey(bookId));
    if (!bookData) {
      console.log(`Book ${bookId} not found`);
      await redisClient.quit();
      return;
    }

    const book = JSON.parse(bookData);

    // Add book to user's book list if not already there
    if (!user.books) {
      user.books = [];
    }

    if (user.books.includes(bookId)) {
      console.log(`Book ${bookId} is already in user's library`);
    } else {
      user.books.push(bookId);
      await redisClient.set(getUserKey(userId), JSON.stringify(user));
      console.log(`✅ Successfully added book "${book.bookTitle}" (${bookId}) to user ${email}`);
    }

    // Update book to set owner if not set
    if (!book.ownerId) {
      book.ownerId = userId;
      await redisClient.set(getBookKey(bookId), JSON.stringify(book));
      console.log(`✅ Set ${email} as owner of book "${book.bookTitle}"`);
    }

    console.log('\nUser books:', user.books);

    await redisClient.quit();
  } catch (error) {
    console.error('Error:', error);
    await redisClient.quit();
  }
}

// Get email and bookId from command line arguments
const email = process.argv[2] || 'Asim_j1@hotmail.com';
const bookId = process.argv[3] || '1759684106874';

console.log(`Adding book ${bookId} to user ${email}...`);
addBookToUser(email, bookId);
