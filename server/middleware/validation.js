import Joi from 'joi';

/**
 * Validation middleware factory
 * Creates middleware to validate request body/params/query
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace with validated data
    req[source] = value;
    next();
  };
}

/**
 * Common validation schemas
 */
export const schemas = {
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).required().messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must include uppercase, lowercase, and numbers',
      'any.required': 'Password is required',
    }),
    name: Joi.string().min(2).max(100).required().messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name must not exceed 100 characters',
      'any.required': 'Name is required',
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  // Book schemas
  createBook: Joi.object({
    bookTitle: Joi.string().max(200).default('Untitled Story'),
    overview: Joi.string().max(5000).allow('').default(''),
    characters: Joi.array().default([]),
    locations: Joi.array().default([]),
    plotlines: Joi.array().default([]),
    chapters: Joi.array().default([]),
    // ... other fields can have defaults
  }).unknown(true), // Allow other fields

  // AI Generation
  aiGenerate: Joi.object({
    type: Joi.string().valid(
      'character', 'location', 'plotline', 'chapter', 'improve',
      'dialogue', 'plot-analysis', 'chapter-outline', 'character-arc',
      'relationship-map', 'timeline', 'transcript'
    ).required(),
    prompt: Joi.string().min(1).max(10000).required().messages({
      'string.max': 'Prompt too long. Maximum 10,000 characters.',
    }),
    context: Joi.object().unknown(true),
    enableWebSearch: Joi.boolean().default(false),
  }),

  imageGenerate: Joi.object({
    prompt: Joi.string().min(1).max(2000).required().messages({
      'string.max': 'Image prompt too long. Maximum 2,000 characters.',
    }),
    context: Joi.object().unknown(true),
  }),

  audioGenerate: Joi.object({
    text: Joi.string().min(1).max(100000).required().messages({
      'string.max': 'Text too long for audio generation. Maximum 100,000 characters.',
    }),
    chapterId: Joi.alternatives().try(Joi.string(), Joi.number()),
    voice: Joi.string().valid('alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer').default('alloy'),
    speed: Joi.number().min(0.25).max(4.0).default(1.0),
  }),

  // File upload
  importExtract: Joi.object({
    minChapterLength: Joi.number().min(100).max(50000).default(500),
    maxChapterLength: Joi.number().min(1000).max(500000).default(100000),
    useAI: Joi.boolean().default(false),
  }),
};
