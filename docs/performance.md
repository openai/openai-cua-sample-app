# Performance Considerations

This document provides guidance on optimizing the performance of your Computer Using Agent (CUA) application.

## Understanding Performance Factors

The performance of a CUA application depends on several factors:

1. **Network Latency**: The time it takes for requests to travel between your application and the OpenAI API
2. **API Processing Time**: The time it takes for the OpenAI API to process your request and generate a response
3. **Computer Environment Performance**: The speed of the computer environment (local browser, remote browser, Docker container)
4. **Screenshot Size and Quality**: Larger screenshots take longer to process
5. **Conversation History Size**: Larger conversation histories increase token usage and processing time
6. **Action Complexity**: Complex sequences of actions take longer to execute than simple ones

## Optimizing API Interactions

### Reduce API Calls

Each call to the OpenAI API adds latency to your application. To reduce the number of API calls:

1. **Batch Actions**: When possible, design your prompts to encourage the model to perform multiple actions in a single turn
2. **Provide Clear Instructions**: Clear prompts help the model accomplish tasks with fewer turns
3. **Use Custom Functions**: For complex operations, use custom functions instead of relying on the model to perform a sequence of basic actions

### Optimize Context Size

Larger contexts take longer to process and consume more tokens:

1. **Limit Conversation History**: If you're building a long-running application, consider pruning old conversation history
2. **Compress Screenshots**: Use lower resolution or compressed screenshots when possible
3. **Use Truncation**: The Agent uses `truncation="auto"` by default, which helps manage large contexts

## Optimizing Computer Environments

### Local Playwright

The LocalPlaywrightComputer is usually the fastest option because it runs locally:

1. **Use Headless Mode**: For automated tasks, use headless mode to reduce overhead:
   ```python
   LocalPlaywrightComputer(headless=True)
   ```
2. **Optimize Browser Settings**: Customize browser launch arguments:
   ```python
   launch_args = [
       f"--window-size={width},{height}", 
       "--disable-extensions", 
       "--disable-gpu",  # Disable GPU acceleration for faster headless operation
       "--no-sandbox",   # Use with caution - reduces security
   ]
   ```

### Docker Environment

The Docker environment's performance depends on your Docker setup:

1. **Allocate Sufficient Resources**: Make sure Docker has enough CPU and memory
2. **Use a Fast VNC Connection**: VNC performance greatly affects DockerComputer performance
3. **Optimize Display Resolution**: Use a lower resolution to reduce VNC traffic

### Remote Browser Environments

Remote browser environments (Browserbase, Scrapybara) have additional network latency:

1. **Choose Geographically Closer Servers**: If available, use servers that are closer to your location
2. **Reduce Screenshot Frequency**: Minimize the number of actions that require screenshots
3. **Use Batch Operations**: Perform multiple actions in sequence before requesting a new screenshot

## Code-Level Optimizations

### Optimize Screenshot Handling

Screenshots are the largest data elements in most CUA applications:

1. **Compress Screenshots**: Consider compressing screenshots before encoding them:
   ```python
   def screenshot(self) -> str:
       # Capture screenshot
       png_bytes = self._page.screenshot(full_page=False)
       
       # Optionally compress the image
       from PIL import Image
       import io
       image = Image.open(io.BytesIO(png_bytes))
       image = image.resize((image.width // 2, image.height // 2))  # Downsample
       
       output = io.BytesIO()
       image.save(output, format='JPEG', quality=70)  # Convert to JPEG with compression
       compressed_bytes = output.getvalue()
       
       return base64.b64encode(compressed_bytes).decode("utf-8")
   ```

2. **Crop Screenshots**: Consider cropping screenshots to the relevant area:
   ```python
   def screenshot(self) -> str:
       # Capture full screenshot
       png_bytes = self._page.screenshot(full_page=False)
       
       # Crop to relevant area
       from PIL import Image
       import io
       image = Image.open(io.BytesIO(png_bytes))
       
       # Example: crop to the top half of the screen
       width, height = image.size
       image = image.crop((0, 0, width, height // 2))
       
       output = io.BytesIO()
       image.save(output, format='PNG')
       cropped_bytes = output.getvalue()
       
       return base64.b64encode(cropped_bytes).decode("utf-8")
   ```

### Optimize Action Execution

1. **Parallelize Actions**: For independent actions, consider parallelizing them:
   ```python
   import threading
   
   def perform_parallel_actions(actions):
       threads = []
       for action in actions:
           thread = threading.Thread(target=action)
           threads.append(thread)
           thread.start()
       
       for thread in threads:
           thread.join()
   ```

2. **Batch Similar Actions**: Group similar actions together:
   ```python
   def type_paragraphs(self, paragraphs):
       for paragraph in paragraphs:
           self._page.keyboard.type(paragraph)
           self._page.keyboard.press("Enter")
           self._page.keyboard.press("Enter")
   ```

### Caching

1. **Cache Screenshots**: If the screen hasn't changed, reuse the previous screenshot:
   ```python
   def screenshot(self) -> str:
       # Check if the screen has changed since the last screenshot
       current_hash = self._get_screen_hash()
       if current_hash == self._last_screen_hash:
           return self._last_screenshot
       
       # If screen has changed, take a new screenshot
       png_bytes = self._page.screenshot(full_page=False)
       screenshot = base64.b64encode(png_bytes).decode("utf-8")
       
       # Update cache
       self._last_screen_hash = current_hash
       self._last_screenshot = screenshot
       
       return screenshot
   ```

2. **Cache Function Results**: For expensive function calls, consider caching results:
   ```python
   import functools
   
   @functools.lru_cache(maxsize=128)
   def expensive_function(self, arg1, arg2):
       # Expensive operation
       return result
   ```

## Measuring Performance

To identify performance bottlenecks, add timing measurements:

```python
import time

def measure_time(func):
    def wrapper(*args, **kwargs):
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        print(f"{func.__name__} took {end_time - start_time:.2f} seconds")
        return result
    return wrapper

class TimedComputer(LocalPlaywrightComputer):
    @measure_time
    def screenshot(self) -> str:
        return super().screenshot()
    
    @measure_time
    def click(self, x: int, y: int, button: str = "left") -> None:
        return super().click(x, y, button)
    
    # etc.
```

Use this data to identify which operations are taking the most time and focus your optimization efforts there.

## Trade-offs

When optimizing for performance, consider these trade-offs:

1. **Quality vs. Speed**: Lower quality screenshots are faster but may lead to less accurate model responses
2. **Safety vs. Speed**: Some safety checks add overhead but are important for security
3. **Flexibility vs. Speed**: Custom functions are faster but less flexible than general-purpose computer actions
4. **Memory vs. Speed**: Caching improves speed but increases memory usage

Choose optimizations that make sense for your specific use case and requirements.

## Environment-Specific Recommendations

### Local Development

For local development, prioritize:
- Fast iteration time with LocalPlaywrightComputer
- Debug mode for detailed information
- Showing images for visual feedback

### Production

For production deployments, prioritize:
- Robustness with error handling and reconnection logic
- Performance optimizations like headless mode and caching
- Memory management for long-running applications 