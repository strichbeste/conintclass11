import fastify, { FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { isValidEmail } from './services/isValidEmail';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();
const server = fastify();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '127.0.0.1';

// PostHog setup
import { PostHog } from 'posthog-node';
const posthogClient = new PostHog(
  process.env.POSTHOG_API_KEY || 'POSTHOG_API_KEY',
  { host: process.env.POSTHOG_HOST || 'https://eu.i.posthog.com' }
);

// Serve index.html at root
server.get('/', async (_, reply) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(filePath, 'utf-8');
  return reply.type('text/html').send(html);
});

/**
 * USERS CRUD
 */
// Get all users
server.get('/api/v1/users', async (_, reply) => {
  try {
    const users = await prisma.user.findMany();
    return reply.status(200).send({ users });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Get single user by ID
server.get('/api/v1/users/:id', async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply
) => {
  try {
    const { id } = request.params;
    const user = await prisma.user.findUnique({
      where: { id: Number(id) },
      include: { posts: true },
    });
    return reply.status(200).send({ user });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Create a user
server.post('/api/v1/users', async (
  request: FastifyRequest<{
    Body: { name: string; email: string };
  }>,
  reply
) => {
  try {
    const { name, email } = request.body;

    if (!isValidEmail(email)) {
      return reply.status(400).send({ error: 'Invalid email' });
    }

    const user = await prisma.user.create({
      data: { name, email },
    });

    // Track: user created
    posthogClient.capture({
      distinctId: String(user.id),
      event: 'user_created',
      properties: { name: user.name, email: user.email },
    });

    return reply.status(201).send({ user });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Update a user
server.put('/api/v1/users/:id', async (
  request: FastifyRequest<{
    Params: { id: string };
    Body: { name?: string; email?: string };
  }>,
  reply
) => {
  try {
    const { id } = request.params;
    const { name, email } = request.body;
    const updatedUser = await prisma.user.update({
      where: { id: Number(id) },
      data: { ...(name && { name }), ...(email && { email }) },
    });
    return reply.status(200).send({ user: updatedUser });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Delete a user
server.delete('/api/v1/users/:id', async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply
) => {
  try {
    const { id } = request.params;
    const user = await prisma.user.delete({ where: { id: Number(id) } });
    return reply.status(200).send({ user });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

/**
 * POSTS CRUD
 */
// Get all posts
server.get('/api/v1/posts', async (_, reply) => {
  try {
    const posts = await prisma.post.findMany({ include: { user: true } });
    return reply.status(200).send({ posts });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Get single post by ID
server.get('/api/v1/posts/:id', async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply
) => {
  try {
    const { id } = request.params;
    const post = await prisma.post.findUnique({
      where: { id: Number(id) },
      include: { user: true },
    });
    return reply.status(200).send({ post });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Create a post — guarded by feature toggle
server.post('/api/v1/posts', async (
  request: FastifyRequest<{
    Body: { title: string; content?: string; userId: number };
  }>,
  reply
) => {
  try {
    const { title, content = '', userId } = request.body;

    if (!title || !userId) {
      return reply.status(400).send({ error: 'title and userId are required' });
    }

    // Feature toggle: is-post-creation-enabled
    const isPostCreationEnabled = await posthogClient.isFeatureEnabled(
      'is-post-creation-enabled',
      String(userId)
    );

    if (!isPostCreationEnabled) {
      return reply.status(403).send({ error: 'Post creation is currently disabled.' });
    }

    const post = await prisma.post.create({
      data: {
        title,
        content,
        user: { connect: { id: userId } },
      },
    });

    // Track: post created
    posthogClient.capture({
      distinctId: String(userId),
      event: 'post_created',
      properties: { postId: post.id, title: post.title },
    });

    return reply.status(201).send({ post });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Update a post
server.put('/api/v1/posts/:id', async (
  request: FastifyRequest<{
    Params: { id: string };
    Body: { title?: string; content?: string };
  }>,
  reply
) => {
  try {
    const { id } = request.params;
    const { title, content } = request.body;
    const updatedPost = await prisma.post.update({
      where: { id: Number(id) },
      data: { ...(title && { title }), ...(content && { content }) },
    });
    return reply.status(200).send({ post: updatedPost });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Delete a post
server.delete('/api/v1/posts/:id', async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply
) => {
  try {
    const { id } = request.params;
    const post = await prisma.post.delete({ where: { id: Number(id) } });
    return reply.status(200).send({ post });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Start server
server.listen({ host: HOST, port: Number(PORT) }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
