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

Based on the current system architecture (using Server-Sent Events for real-time updates):

1. **VITE_API_URL** - Your API Gateway REST API URL
   - Example: `https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod`
   - Get this from your AWS CDK deployment output
   - Used for: API calls to `/insights/recent`, `/metrics`, etc.

2. **VITE_SSE_URL** - Your Server-Sent Events URL (optional)
   - Example: `https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/stream`
   - Get this from your AWS CDK deployment output
   - Used for: Real-time streaming updates (currently using polling)

3. **VITE_AWS_REGION** - AWS Region (optional)
   - Example: `us-east-2`
   - Default: `us-east-2`
   - Used for: AWS SDK configuration

### Setting Environment Variables

#### Via Vercel CLI:
```bash
vercel env add VITE_API_URL
vercel env add VITE_SSE_URL
vercel env add VITE_AWS_REGION
```

#### Via Vercel Dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add the following variables:
   - `VITE_API_URL` - Your REST API Gateway URL (required)
   - `VITE_SSE_URL` - Your Server-Sent Events URL (optional)
   - `VITE_AWS_REGION` - Your AWS region (optional, defaults to us-east-2)

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

#### API Connection Issues
1. Verify `VITE_API_URL` environment variable is set correctly
2. Check CORS settings on API Gateway (must allow your Vercel domain)
3. Verify API Gateway is deployed and accessible
4. Check browser console for detailed errors (Network tab)
5. Test API directly: `curl https://your-api.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=10`

### Update Environment Variables

```bash
# Update production environment variable
vercel env rm VITE_API_URL production
vercel env add VITE_API_URL production

# Update SSE URL (optional)
vercel env rm VITE_SSE_URL production
vercel env add VITE_SSE_URL production

# Update AWS region (optional)
vercel env rm VITE_AWS_REGION production
vercel env add VITE_AWS_REGION production

# Trigger redeployment after env change
vercel --prod
```

### Getting Your API URL from CDK Deployment

After deploying your CDK stack:

```bash
# From project root
cd cdk
npm run deploy

# Look for output like:
# ✅  IOpsDashboard-CoreStack
#
# Outputs:
# IOpsDashboard-CoreStack.ApiEndpoint = https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod
# IOpsDashboard-CoreStack.SSEEndpoint = https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/stream
```

Use the `ApiEndpoint` value for `VITE_API_URL` and `SSEEndpoint` for `VITE_SSE_URL`.

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
