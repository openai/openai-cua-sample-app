# Safety Considerations

## Overview

The Computer Using Agent (CUA) has significant capabilities that come with potential risks. This document outlines the safety measures implemented in the codebase to mitigate these risks.

## URL Blocklisting

In browser-based environments, the system includes URL blocklisting to prevent access to potentially malicious or inappropriate websites.

### Implementation in utils.py

```python
BLOCKED_DOMAINS = [
    "maliciousbook.com",
    "evilvideos.com",
    "darkwebforum.com",
    "shadytok.com",
    "suspiciouspins.com",
    "ilanbigio.com",
]

def check_blocklisted_url(url: str) -> None:
    """Raise ValueError if the given URL (including subdomains) is in the blocklist."""
    hostname = urlparse(url).hostname or ""
    if any(
        hostname == blocked or hostname.endswith(f".{blocked}")
        for blocked in BLOCKED_DOMAINS
    ):
        raise ValueError(f"Blocked URL: {url}")
```

This function checks if a URL's hostname (or any of its subdomains) matches any entry in the `BLOCKED_DOMAINS` list. If a match is found, it raises a `ValueError` with the blocked URL.

### Integration in Agent Implementation

The Agent class integrates URL blocklisting in its handling of computer calls for browser environments:

```python
# additional URL safety checks for browser environments
if self.computer.environment == "browser":
    current_url = self.computer.get_current_url()
    check_blocklisted_url(current_url)
    call_output["output"]["current_url"] = current_url
```

### Network Interception

For Playwright-based browser environments, the system also includes network interception to block requests to suspicious domains:

```python
# Set up network interception to flag URLs matching domains in BLOCKED_DOMAINS
def handle_route(route, request):
    url = request.url
    if check_blocklisted_url(url):
        print(f"Flagging blocked domain: {url}")
        route.abort()
    else:
        route.continue_()

self._page.route("**/*", handle_route)
```

This intercepts all network requests and aborts them if they target a blocked domain.

## Safety Check Acknowledgment

The CUA model may sometimes generate safety checks for potentially risky actions. The system implements a callback mechanism to handle these checks:

### Default Implementation

```python
def acknowledge_safety_check_callback(message: str) -> bool:
    response = input(
        f"Safety Check Warning: {message}\nDo you want to acknowledge and proceed? (y/n): "
    ).lower()
    return response.strip() == "y"
```

This function displays the safety check message to the user and asks for explicit acknowledgment before proceeding.

### Integration in Agent Implementation

```python
# if user doesn't ack all safety checks exit with error
pending_checks = item.get("pending_safety_checks", [])
for check in pending_checks:
    message = check["message"]
    if not self.acknowledge_safety_check_callback(message):
        raise ValueError(
            f"Safety check failed: {message}. Cannot continue with unacknowledged safety checks."
        )
```

If any safety check is not acknowledged, the Agent raises a `ValueError` and halts execution.

## DNS Safety in Docker Environment

For the Docker environment, the system uses a restricted DNS server to limit access to websites:

```bash
docker run --rm -it --name cua-sample-app -p 5900:5900 --dns=1.1.1.3 -e DISPLAY=:99 cua-sample-app
```

The `--dns=1.1.1.3` flag restricts the accessible websites to a smaller, safer set.

## Container Isolation

The Docker environment runs in a container, providing isolation from the host system:

- Limited network access
- No access to host file system
- Controlled execution environment

## Browser Safeguards

Playwright-based browsers are launched with safeguards:

```python
launch_args = [
    f"--window-size={width},{height}", 
    "--disable-extensions", 
    "--disable-file-system"
]
browser = self._playwright.chromium.launch(
    chromium_sandbox=True,
    headless=self.headless,
    args=launch_args,
    env={}
)
```

- `--disable-extensions`: Disables browser extensions
- `--disable-file-system`: Restricts file system access
- `chromium_sandbox=True`: Enables the Chromium sandbox for additional isolation

## Best Practices for Implementation

When extending or modifying the CUA implementation, consider these safety best practices:

1. **Expand Blocklists**: Add more domains to the `BLOCKED_DOMAINS` list as needed.
2. **Custom Safety Callbacks**: Implement more sophisticated safety check callbacks for specific use cases.
3. **Request Filtering**: Add additional filtering for network requests in browser environments.
4. **Environment Isolation**: Ensure proper isolation for computer environments, especially for production use.
5. **Limited Access Scopes**: Restrict the scope of what the CUA can access and control.
6. **Monitoring and Logging**: Implement comprehensive logging to track the CUA's actions.
7. **User Intervention**: Always provide mechanisms for user intervention and oversight.

## Limitations and Disclaimers

Even with these safety measures, the CUA is still in preview and may have vulnerabilities:

- Safety checks might not catch all potentially harmful actions
- Blocklists may be incomplete or bypassed
- Browser or system vulnerabilities could be exploited

As noted in the official documentation:

> [!CAUTION]  
> Computer use is in preview. Because the model is still in preview and may be susceptible to exploits and inadvertent mistakes, we discourage trusting it in authenticated environments or for high-stakes tasks. 