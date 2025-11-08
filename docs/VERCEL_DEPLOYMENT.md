# Vercel Deployment Guide

## Prerequisites

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

## Environment Variables Setup

Before deploying, you need to set up environment variables in Vercel:

### Required Environment Variables

1. **VITE_API_URL** - Your API Gateway URL
   - Example: `https://your-api-id.execute-api.us-east-1.amazonaws.com/prod`
   - Get this from your AWS CDK deployment output

2. **VITE_WS_URL** - Your WebSocket URL
   - Example: `wss://your-ws-id.execute-api.us-east-1.amazonaws.com/prod`
   - Get this from your AWS CDK deployment output

### Setting Environment Variables

#### Via Vercel CLI:
```bash
vercel env add VITE_API_URL
vercel env add VITE_WS_URL
```

#### Via Vercel Dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add the following variables:
   - `VITE_API_URL` - Your API URL
   - `VITE_WS_URL` - Your WebSocket URL

## Deployment Steps

### 1. Initial Setup (First Time)

```bash
# From project root
vercel
```

Follow the prompts:
- **Set up and deploy?** Yes
- **Which scope?** Select your account/team
- **Link to existing project?** No
- **What's your project's name?** iops-dashboard
- **In which directory is your code located?** ./
- **Want to modify settings?** No

### 2. Deploy to Production

```bash
# Deploy to production
vercel --prod
```

### 3. Deploy to Preview (Staging)

```bash
# Deploy to preview environment
vercel
```

## Automatic Deployments

### GitHub Integration

1. Go to Vercel Dashboard
2. Import your GitHub repository
3. Configure build settings:
   - **Framework Preset:** Other
   - **Root Directory:** ./
   - **Build Command:** `cd frontend && npm install && npm run build`
   - **Output Directory:** `frontend/dist`
   - **Install Command:** `cd frontend && npm install`

4. Add environment variables in the dashboard

5. Every push to `main` will auto-deploy to production
6. Every PR will create a preview deployment

## Configuration Files

### vercel.json
Located in project root. Contains:
- Build commands
- Output directory
- Environment variable references
- Rewrites for API proxy
- Security headers
- Cache control headers

### .vercelignore
Located in `frontend/.vercelignore`. Excludes:
- node_modules
- Environment files
- Build artifacts
- IDE files

## Post-Deployment

### Verify Deployment

1. Check deployment URL in terminal output
2. Visit the deployed URL
3. Open browser DevTools > Network tab
4. Verify API calls are working
5. Check WebSocket connection

### Troubleshooting

#### Build Fails
```bash
# Check build locally first
cd frontend
npm install
npm run build
```

#### Environment Variables Not Working
```bash
# List all env vars
vercel env ls

# Pull env vars to local
vercel env pull
```

#### API/WebSocket Connection Issues
1. Verify environment variables are set correctly
2. Check CORS settings on API Gateway
3. Ensure WebSocket route is properly configured
4. Check browser console for detailed errors

### Update Environment Variables

```bash
# Update production environment variable
vercel env rm VITE_API_URL production
vercel env add VITE_API_URL production

# Trigger redeployment after env change
vercel --prod
```

## Performance Optimization

The Vercel configuration includes:

1. **Code Splitting**: Vendor chunks separated in `vite.config.ts`
2. **Caching**: Static assets cached for 1 year
3. **Security Headers**: XSS protection, frame options, content sniffing protection
4. **Source Maps**: Enabled for debugging production issues

## Custom Domain

1. Go to Vercel Dashboard > Your Project > Settings > Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. SSL certificate auto-provisioned

## Monitoring

- **Analytics**: Enable Vercel Analytics in dashboard
- **Logs**: View real-time logs with `vercel logs`
- **Performance**: Check Core Web Vitals in dashboard

## Cost Considerations

- **Hobby Plan**: Free for personal projects
- **Pro Plan**: Required for team collaboration
- **Enterprise**: For large-scale applications

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Environment Variables Best Practices](https://vercel.com/docs/environment-variables)
