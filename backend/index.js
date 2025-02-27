import bcrypt from 'bcryptjs';
import jwt from '@tsndr/cloudflare-worker-jwt';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const db = env.DB;
        const origin = 'https://my-social-app.pages.dev';
        const jwtSecret = env.JWT_SECRET;

        const corsResponse = (response, status = 200) => {
            const headers = {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Content-Type': 'application/json',
            };
            return new Response(JSON.stringify(response), { status, headers });
        };

        if (method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': origin,
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            });
        }

        try {
            console.log(`Incoming request: ${method} ${path}`);

            if (path === '/api/users/register' && method === 'POST') {
                const { username, email, password } = await request.json();
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                await db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').bind(username, email, hashedPassword).run();
                console.log(`User registered: ${username}`);
                return corsResponse({ message: 'User registered successfully' }, 201);
            } else if (path === '/api/users/login' && method === 'POST') {
                const { username, password } = await request.json();
                console.log("Login Request:", JSON.stringify({ username, password }));
                const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
                console.log("Database User:", JSON.stringify(user));
                if (user && await bcrypt.compare(password, user.password)) {
                    console.log("bcrypt compare success");
                    console.log(`User logged in: ${username}`);
                    // Log the generated JWT token - for debugging
                    const token = await jwt.sign({ username: user.username }, jwtSecret);
                    console.log("JWT Token Generated:", token);
                    return corsResponse({ message: 'Login successful', token });
                } else {
                    console.log("bcrypt compare failed");
                    return corsResponse({ error: 'Invalid username or password' }, 401);
                }
            } else if (path === '/api/data' && method === 'GET') {
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }
                const token = authHeader.substring(7);
                const isValid = await jwt.verify(token, jwtSecret);
                if (!isValid) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }
                const results = await db.prepare('SELECT id, username, email FROM users').all();
                const data = results.results;
                return corsResponse(data);
            } else if (path === '/api/posts' && method === 'POST') {
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }
                const token = authHeader.substring(7);
                const isValid = await jwt.verify(token, jwtSecret);
                if (!isValid) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }

                let username;
                try {
                    const decodedToken = await jwt.decode(token, jwtSecret);
                    username = decodedToken.username;
                    if (!username) {
                        console.error("JWT missing username claim");
                        return corsResponse({ error: 'Unauthorized: Invalid token (missing username)' }, 401);
                    }
                } catch (jwtError) {
                    console.error("JWT decode error:", jwtError);
                    return corsResponse({ error: 'Unauthorized: Invalid token' }, 401);
                }

                const { content } = await request.json();

                console.log("DEBUG: Attempting to create post with:");
                console.log("DEBUG: Username:", username);
                console.log("DEBUG: Content:", content);

                const result = await db.prepare('INSERT INTO posts (username, content) VALUES (?, ?) RETURNING id, username, content').bind(username, content).first();

                console.log("DEBUG: Database INSERT result:", JSON.stringify(result)); // Added logging for 'result'

                return corsResponse(result, 201);
            } else if (path === '/api/posts' && method === 'GET') {
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }
                const token = authHeader.substring(7);
                const isValid = await jwt.verify(token, jwtSecret);
                if (!isValid) {
                    return corsResponse({ error: 'Unauthorized' }, 401);
                }
                const results = await db.prepare('SELECT id, username, content FROM posts ORDER BY id DESC').all();
                const data = results.results;
                return corsResponse(data);
            } else if (path === '/') {
                return new Response('Welcome to my Cloudflare Worker!', {
                    headers: { 'Content-Type': 'text/plain' },
                });
            } else {
                return new Response('Not Found', { status: 404 });
            }
        } catch (err) {
            console.error(`Worker error: ${err.message}`, err);
            return corsResponse({ error: err.message }, 500);
        }
    },
};
