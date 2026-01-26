/**
 * Authorization Middleware
 *
 * Provides authorization checks for resource ownership and permissions.
 * Used to ensure users can only access/modify resources they own or have permission to.
 */

// Helper functions for Redis keys
const getBookKey = (bookId) => `book:${bookId}`;

// Redis client will be injected during middleware creation
let redisClient = null;

/**
 * Initialize authorization middleware with Redis client
 * @param {Object} client - Redis client instance
 */
export function initializeAuthorization(client) {
  redisClient = client;
}

/**
 * Middleware to verify book ownership or collaborator access
 *
 * Checks if the authenticated user:
 * 1. Owns the book (is the ownerId), OR
 * 2. Is a collaborator with appropriate permissions
 *
 * Adds `req.book`, `req.bookId`, `req.isOwner`, and `req.collaboratorRole` to request object
 *
 * @param {Object} options - Configuration options
 * @param {string[]} options.requiredPermissions - Required permissions (e.g., ['write', 'delete'])
 * @param {boolean} options.allowCollaborators - Whether to allow collaborators (default: true)
 * @param {string[]} options.blockedRoles - Roles that are not allowed (e.g., ['viewer'])
 */
export const verifyBookOwnership = (options = {}) => {
  const {
    requiredPermissions = [],
    allowCollaborators = true,
    blockedRoles = []
  } = options;

  return async (req, res, next) => {
    try {
      // Extract book ID from params or body
      const bookId = req.params.id || req.params.bookId || req.body.bookId;

      if (!bookId) {
        return res.status(400).json({ error: 'Book ID required' });
      }

      // Fetch book from Redis
      const bookData = await redisClient.get(getBookKey(bookId));

      if (!bookData) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const book = JSON.parse(bookData);

      // Check ownership
      const isOwner = book.ownerId === req.user.id;

      // Check collaborator status
      let collaborator = null;
      let collaboratorRole = null;

      if (allowCollaborators && book.collaborators) {
        collaborator = book.collaborators.find(c => c.email === req.user.email);
        collaboratorRole = collaborator?.role;
      }

      // Authorization logic
      if (!isOwner && !collaborator) {
        return res.status(403).json({
          error: 'Not authorized to access this book',
          message: 'You must be the book owner or a collaborator to access this resource.'
        });
      }

      // Check if role is blocked
      if (!isOwner && collaboratorRole && blockedRoles.includes(collaboratorRole)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `Users with role '${collaboratorRole}' cannot perform this action.`
        });
      }

      // Check required permissions
      if (!isOwner && requiredPermissions.length > 0) {
        const hasPermissions = requiredPermissions.every(permission => {
          if (collaboratorRole === 'editor') {
            return ['read', 'write'].includes(permission);
          } else if (collaboratorRole === 'viewer') {
            return permission === 'read';
          }
          return false;
        });

        if (!hasPermissions) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            message: `This action requires permissions: ${requiredPermissions.join(', ')}`
          });
        }
      }

      // Attach book data to request
      req.book = book;
      req.bookId = bookId;
      req.isOwner = isOwner;
      req.collaboratorRole = collaboratorRole;

      next();
    } catch (error) {
      console.error('Error in verifyBookOwnership middleware:', error);
      res.status(500).json({ error: 'Failed to verify book ownership' });
    }
  };
};

/**
 * Middleware to verify that user is the owner (not just a collaborator)
 * Useful for operations like deletion that only owners should perform
 */
export const requireOwnership = async (req, res, next) => {
  try {
    const bookId = req.params.id || req.params.bookId || req.body.bookId;

    if (!bookId) {
      return res.status(400).json({ error: 'Book ID required' });
    }

    const bookData = await redisClient.get(getBookKey(bookId));

    if (!bookData) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const book = JSON.parse(bookData);

    if (book.ownerId !== req.user.id) {
      return res.status(403).json({
        error: 'Owner access required',
        message: 'Only the book owner can perform this action.'
      });
    }

    req.book = book;
    req.bookId = bookId;
    req.isOwner = true;

    next();
  } catch (error) {
    console.error('Error in requireOwnership middleware:', error);
    res.status(500).json({ error: 'Failed to verify ownership' });
  }
};

/**
 * Middleware to verify write access (owner or editor)
 * Blocks viewers from making modifications
 */
export const requireWriteAccess = verifyBookOwnership({
  allowCollaborators: true,
  blockedRoles: ['viewer'],
  requiredPermissions: ['write']
});

/**
 * Middleware to verify read access (owner, editor, or viewer)
 */
export const requireReadAccess = verifyBookOwnership({
  allowCollaborators: true,
  requiredPermissions: ['read']
});
