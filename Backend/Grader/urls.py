from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('upload/', include('UploadQP.urls')),
    path('evaluate/', include('Evaluate.urls')),
    path('student/', include('Student.urls')),
    path('rag/', include('RagPipe.urls')),
    path('imgeval/', include('ImageEval.urls')),
    path('imageto/', include('ImagetoText.urls')),
]
