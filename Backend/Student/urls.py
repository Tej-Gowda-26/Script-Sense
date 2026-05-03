from django.urls import path
from . import views

urlpatterns = [
    path('feedback/', views.add_or_get_feedback_marks),
    path('sheets/',   views.get_answer_sheets),
    path('signup/', views.signup, name='signup'),
    path('login/', views.login, name='login'),
    path('subjects/', views.get_registered_subjects, name='subjects'),
]